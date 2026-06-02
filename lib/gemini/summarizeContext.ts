/**
 * Summarizer pre-step for the chat coach.
 *
 * Before the main coach Gemini call (now Gemini 2.5 Pro), run a fast
 * Gemini Flash call that distills the athlete's recent training state
 * into 5-10 bullet points. Inject the summary INSTEAD of the raw
 * workout/state/external-activity context blobs.
 *
 * Trade-off: one extra API call + ~200ms of added latency, but the main
 * Pro call's prompt drops from ~30k tokens to ~5k tokens. Net: faster
 * end-to-end (Pro is slower per token), cheaper (Pro charges much more
 * per token than Flash), and sharper responses (less noise for Pro to
 * sift through).
 *
 * Resilience: if the summarizer call fails, fall back to a deterministic
 * compact summary built from the same inputs — the chat turn proceeds
 * with reduced context rather than failing.
 */
import { gemini, MODELS } from "./client";
import { withGeminiRetry } from "./retry";
import type { WorkoutLog, FeedbackSentiment } from "@/lib/db/schema";
import type { ExternalActivitySummary } from "@/lib/coach/externalActivity";

export type ContextSummarizerInput = {
  athleteName: string;
  /** Most recent N workout logs with their parsed sentiment. */
  recentLogs: Array<WorkoutLog & { sentiment?: FeedbackSentiment | null }>;
  /** Current FSM state. */
  state: {
    currentLevel: number;
    freezeActive: boolean;
    freezeReason: string | null;
    manualOverride: boolean;
  } | null;
  /** Active primary goal. */
  goal: {
    category: string;
    type: string;
    targetValue: string;
    targetUnit: string;
    targetDate: string;
    note: string | null;
  } | null;
  /** Aggregate summary of external HC sessions, post-dedupe. */
  externalActivity: ExternalActivitySummary | null;
  /** Per-session lines for sessions that are still ambiguous and pending classification. */
  pendingAmbiguousSessions: string[];
};

const SUMMARIZER_PROMPT = `You are a context-compression assistant for a sports coaching app. Given structured data about an athlete's recent training state, produce a compact bullet-point summary (5-10 bullets, max ~250 words total) capturing the facts a coach would need to give a specific reply on the next message.

Output rules:
- Plain prose bullets, one fact per bullet, no headers.
- Lead each bullet with the most important detail (date, number, status).
- Combine related facts into one bullet when natural ("Last 3 runs all RPE 6 with foot pain 1-2 — green band").
- Skip null / zero / "no data" — don't waste bullets on absence.
- If goal exists, the bullet about it should include category, target, and weeks-to-target.
- If freeze is active, surface it explicitly.
- If ambiguous external sessions exist, list each as one bullet so the coach can ask the athlete to classify.
- Use short ISO dates (YYYY-MM-DD) or "today" / "yesterday" / "3 days ago".
- Be specific with numbers (distance, RPE, pain, pace). Round sensibly.

Output ONLY the bullets, one per line, starting with "- ".`;

export type CoachContextSummary = {
  /** Compact bullet-point summary suitable for direct prompt injection. */
  bullets: string;
  /** Which path produced the summary — useful for logs / metrics. */
  source: "gemini" | "fallback";
  /** Approx token count (chars / 4) of the bullets. */
  approxTokens: number;
};

export async function summarizeCoachContext(
  input: ContextSummarizerInput,
): Promise<CoachContextSummary> {
  // Build the structured input the summarizer sees.
  const structuredInput = buildStructuredInput(input);

  try {
    const summarizerModel = gemini().getGenerativeModel({
      model: MODELS.FAST, // gemini-2.5-flash — cheap, fast, sufficient for compression
      systemInstruction: SUMMARIZER_PROMPT,
      generationConfig: {
        temperature: 0.1, // factual, no creativity
        maxOutputTokens: 800, // ~200 words of bullets
      },
    });

    const result = await withGeminiRetry(
      () => summarizerModel.generateContent(structuredInput),
      { maxAttempts: 2, baseDelayMs: 500 }, // tighter retry — fall back fast
    );

    let bullets = "";
    try {
      bullets = result.response.text().trim();
    } catch {
      bullets = "";
    }

    if (bullets.length === 0) {
      return { ...buildFallback(input), source: "fallback" };
    }
    return {
      bullets,
      source: "gemini",
      approxTokens: Math.ceil(bullets.length / 4),
    };
  } catch (err) {
    console.warn("[summarizeCoachContext] gemini failed, using fallback:", err);
    return { ...buildFallback(input), source: "fallback" };
  }
}

/** Compact, deterministic fallback summary — used when Gemini Flash fails.
 *  Less polished than the Gemini summary but contains the same facts. */
function buildFallback(input: ContextSummarizerInput): {
  bullets: string;
  approxTokens: number;
} {
  const lines: string[] = [];

  if (input.goal) {
    const daysToTarget = Math.max(
      0,
      Math.floor(
        (new Date(input.goal.targetDate).getTime() - Date.now()) /
          (24 * 60 * 60 * 1000),
      ),
    );
    lines.push(
      `- Active goal: ${input.goal.category} — ${input.goal.type} = ${input.goal.targetValue} ${input.goal.targetUnit} by ${input.goal.targetDate} (${daysToTarget} days)`,
    );
  }

  if (input.state) {
    lines.push(
      `- Coach level ${input.state.currentLevel}/10${input.state.freezeActive ? ` · FROZEN (${input.state.freezeReason ?? "unspecified"})` : ""}${input.state.manualOverride ? " · manual override active" : ""}`,
    );
  }

  // Last 5 workouts — most recent first
  const last5 = input.recentLogs.slice(0, 5);
  for (const l of last5) {
    const dist = l.distanceKm ? `${parseFloat(l.distanceKm).toFixed(1)} km` : null;
    const dur = l.durationSec
      ? `${Math.floor(l.durationSec / 60)} min`
      : null;
    const symptoms = l.sentiment?.symptoms?.length
      ? ` · ${l.sentiment.symptoms.join(", ")}`
      : "";
    const dateLabel = formatRelativeDate(l.performedAt);
    const detail = [l.type, dist, dur].filter(Boolean).join(" ");
    lines.push(
      `- ${dateLabel}: ${detail} · RPE ${l.rpe}/10 · pain ${l.footPain}/10${symptoms}`,
    );
  }

  if (input.externalActivity && input.externalActivity.count > 0) {
    lines.push(
      `- External sessions (30d): ${input.externalActivity.count} sessions, ${input.externalActivity.totalActiveMin} active min, ${input.externalActivity.totalDistanceKm} km total`,
    );
  }

  for (const s of input.pendingAmbiguousSessions) {
    lines.push(`- AMBIGUOUS: ${s}`);
  }

  const bullets = lines.join("\n");
  return { bullets, approxTokens: Math.ceil(bullets.length / 4) };
}

function buildStructuredInput(input: ContextSummarizerInput): string {
  // Plain text rather than JSON so the summarizer can do natural-language
  // compression without first parsing a structure.
  const parts: string[] = [`Athlete: ${input.athleteName}`];

  if (input.goal) {
    const daysToTarget = Math.max(
      0,
      Math.floor(
        (new Date(input.goal.targetDate).getTime() - Date.now()) /
          (24 * 60 * 60 * 1000),
      ),
    );
    parts.push(
      `Active goal: ${input.goal.category} → ${input.goal.type}=${input.goal.targetValue}${input.goal.targetUnit} by ${input.goal.targetDate} (${daysToTarget} days remaining)${input.goal.note ? ` — note: ${input.goal.note}` : ""}`,
    );
  }

  if (input.state) {
    parts.push(
      `Coach state: level ${input.state.currentLevel}/10, freeze=${input.state.freezeActive ? `YES (${input.state.freezeReason ?? "n/a"})` : "no"}, manualOverride=${input.state.manualOverride}`,
    );
  }

  if (input.recentLogs.length > 0) {
    parts.push("Recent workouts (newest first):");
    for (const l of input.recentLogs.slice(0, 10)) {
      const dateLabel = formatRelativeDate(l.performedAt);
      const dist = l.distanceKm ? ` ${parseFloat(l.distanceKm).toFixed(2)}km` : "";
      const dur = l.durationSec ? ` ${Math.floor(l.durationSec / 60)}min` : "";
      const symptoms = l.sentiment?.symptoms?.length
        ? ` symptoms=[${l.sentiment.symptoms.join(",")}]`
        : "";
      const notes = l.notesRaw?.trim() ? ` notes="${l.notesRaw.slice(0, 60)}"` : "";
      parts.push(
        `  ${dateLabel} ${l.type}${dist}${dur} RPE=${l.rpe} pain=${l.footPain}${symptoms}${notes}`,
      );
    }
  }

  if (input.externalActivity && input.externalActivity.count > 0) {
    parts.push(
      `External HC sessions (30d): ${input.externalActivity.count} sessions, ${input.externalActivity.totalActiveMin} min, ${input.externalActivity.totalDistanceKm} km total`,
    );
  }

  if (input.pendingAmbiguousSessions.length > 0) {
    parts.push("Ambiguous external sessions (need classification):");
    for (const s of input.pendingAmbiguousSessions) {
      parts.push(`  ${s}`);
    }
  }

  return parts.join("\n");
}

function formatRelativeDate(d: Date): string {
  const day = 24 * 60 * 60 * 1000;
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / day);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  return new Date(d).toISOString().slice(0, 10);
}
