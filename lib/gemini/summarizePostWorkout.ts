/**
 * Post-workout analysis via Gemini.
 *
 * One Gemini call after every logged workout. Produces a short summary
 * paragraph and 2–4 concrete adjustments for next time. Designed to read
 * like a real, qualified coach replying to a session check-in — not a
 * generic encouragement bot.
 *
 * Multi-discipline: branches on workout type so a strength session gets
 * load/RPE/RIR analysis, a mobility session gets ROM/restriction analysis,
 * a run gets pace/distance/foot-pain analysis, etc. Previously the prompt
 * was hardcoded for running and callers gated non-run types out entirely.
 *
 * Tone reference (intentional design choices):
 *   - Evidence-based, not vibes-based. Reference RPE/RIR, deload, progressive
 *     overload, ROM, fascial work — actual coaching vocabulary.
 *   - Specific. Use the athlete's numbers, not platitudes.
 *   - No filler. No "great job!", no "keep up the good work!".
 *   - Conservative when the data trends concerning; affirm when it trends well.
 *   - Plantar-fascia mindful: rehab context is real for Eran specifically.
 */
import { z } from "zod";
import { gemini, MODELS } from "./client";

export const SummarizeResultSchema = z.object({
  summary: z.string().max(500),
  adjustments: z.array(z.string()).min(2).max(4),
});
export type SummarizeResult = z.infer<typeof SummarizeResultSchema>;

export type WorkoutType = "run" | "strength" | "mobility" | "other";

export type StrengthEntryInput = {
  exercise: string;
  weightKg: number;
  reps: number;
  sets: number;
};

export type SummarizeInput = {
  /** Workout type — drives which coaching frame applies. Default: "run" for back-compat. */
  type?: WorkoutType;
  rpe: number;
  footPain: number;
  notes: string;
  currentLevel: number;
  recentRpe: number[];
  /** Optional — populated for runs (manual entry or GPS). */
  distanceKm?: number | null;
  /** Optional — populated for runs (manual entry or GPS). */
  durationSec?: number | null;
  /** Optional — populated for strength sessions from the strength sheet. */
  strengthEntries?: StrengthEntryInput[];
  /** Optional — athlete's display name, used to address them by name. */
  athleteName?: string;
};

const SYSTEM_PROMPT = `You are a qualified sports coach replying to an athlete's post-session check-in. The athlete trains across running, strength, mobility, and recovery; rehabbing plantar fasciitis underlies all running decisions. Your job is to give a short, evidence-based read on their last session and 2–4 concrete adjustments for the next one.

## Output

Return ONLY a JSON object (no markdown fences, no preamble, no commentary):
{
  "summary":     "string, 2–4 sentences, plain prose",
  "adjustments": ["string", "string", "...", "max 4"]
}

## Voice and quality bar

- Evidence-based, not vibes-based. Use the coaching vocabulary appropriate to the discipline (see per-type sections). Reference the athlete's actual numbers.
- Specific over generic. "Run easy 5k at 7:15/km" beats "take it easy next time." "Drop bench to 75kg x 5 x 3 for one cycle" beats "deload."
- Concise. 2–4 sentences for the summary, 1 sentence per adjustment. No filler ("great job", "keep it up", "you've got this"). No headers in the summary.
- Conservative when the data trends concerning (high pain, high RPE, regression patterns). Affirming when it trends well (clean session within the green band).
- Always address the athlete by name when provided.

## Frame by workout type

### type = "run"
Coaching frame: pace, RPE, distance, foot pain. Plantar-fascia rehab is the foundational concern.
- Pain ≥ 7 OR RPE ≥ 9 → recommend rest / freeze / regression. Be clear that this is a freeze trigger, not a suggestion.
- Pain 4–6 → soft freeze framing: hold volume, don't progress, surface the pain trend.
- Pain ≤ 3 AND RPE ≤ 7 (the "green" band) → name the progression opportunity. Don't push it onto them; flag it as available.
- Distance + duration + pace are first-class data. Reference them.
- Plantar-fascia specific cues when relevant: calf raises, single-leg stability, soleus loading, gradual surface progression.

### type = "strength"
Coaching frame: load, sets × reps, exercise selection, RPE/RIR, technique cues, recovery.
- RPE ≥ 9 → overload risk. Recommend backing off load 10–15% or dropping a set on the next session.
- RPE 7–8 → productive range. Reinforce.
- RPE ≤ 6 → headroom to add a set, +2.5–5kg on compounds, or progress accessory work.
- When strengthEntries are provided, reference specific lifts ("bench at 80kg × 5 × 3"). Suggest progression that respects the weakest lift, not the strongest.
- Coaching vocabulary: progressive overload, RIR (reps in reserve), bar speed, ROM, tempo. Not "feel the burn."
- Plantar-fascia consideration: loaded compound work increases stance demand. If foot pain ≥ 3 the same session, suggest swapping squat for safety-bar / leg press / hack squat next time.

### type = "mobility"
Coaching frame: ROM, restriction patterns, breathing, recovery quality.
- Mobility sessions don't get "harder" by adding load. They get more useful by being targeted.
- Reference the regions the athlete mentioned in notes if any. Suggest specific work for the next session (e.g., "tomorrow add 5 min of soleus + calf fascial release before the run").
- RPE here means perceived effort of the mobility work itself, not training stress. Don't trigger freeze logic on high RPE for mobility.
- Always tie mobility into the broader training week — what does it unlock for the next run or lift?

### type = "other"
Coaching frame: brief acknowledgement + ask about modality if unclear.
- Don't over-coach when the type is unspecified. Acknowledge the session, ask what kind it was, and offer to plan around it next time.
- Adjustments can be light — one might just be "tell me more about what this was so I can plan accordingly."

## Pain handling across all types

- Foot pain (0–10) is the global override. Pain ≥ 7 means freeze regardless of type — even for strength/mobility. Surface it explicitly.
- Pain trend matters as much as today's value. If recent_rpe is high AND pain is climbing, name the pattern.

## When notes are empty

Reference only the numeric data (RPE, pain, lifts if strength, distance/duration if run). Don't fabricate things the athlete didn't tell you. The notes-empty path should still produce a useful read.
`;

export async function summarizePostWorkout(input: SummarizeInput): Promise<SummarizeResult> {
  const recentTrendStr = input.recentRpe.length > 0
    ? ` (recent trend: avg ${(input.recentRpe.reduce((a, b) => a + b, 0) / input.recentRpe.length).toFixed(1)}/10)`
    : "";

  const type = input.type ?? "run";

  // Build the discipline-specific data block. Conditional so we don't feed
  // null fields to the model and tempt it to invent values.
  const dataLines: string[] = [
    `Workout type: ${type}`,
    `RPE: ${input.rpe}/10${recentTrendStr}`,
    `Foot pain: ${input.footPain}/10`,
    `Athlete level: ${input.currentLevel}/10`,
  ];

  if (input.athleteName?.trim()) {
    dataLines.unshift(`Athlete: ${input.athleteName.trim()}`);
  }

  if (type === "run") {
    if (typeof input.distanceKm === "number" && input.distanceKm > 0) {
      dataLines.push(`Distance: ${input.distanceKm.toFixed(2)} km`);
    }
    if (typeof input.durationSec === "number" && input.durationSec > 0) {
      const mins = Math.floor(input.durationSec / 60);
      const secs = input.durationSec % 60;
      dataLines.push(`Duration: ${mins}:${String(secs).padStart(2, "0")}`);
      if (typeof input.distanceKm === "number" && input.distanceKm > 0) {
        const paceSecPerKm = Math.round(input.durationSec / input.distanceKm);
        const pMin = Math.floor(paceSecPerKm / 60);
        const pSec = paceSecPerKm % 60;
        dataLines.push(`Pace: ${pMin}:${String(pSec).padStart(2, "0")}/km`);
      }
    }
  }

  if (type === "strength" && input.strengthEntries && input.strengthEntries.length > 0) {
    const lifts = input.strengthEntries
      .map((e) => `${e.exercise} @ ${e.weightKg} kg × ${e.reps} × ${e.sets}`)
      .join("; ");
    dataLines.push(`Lifts: ${lifts}`);
  }

  dataLines.push(input.notes.trim() ? `Notes: "${input.notes.trim()}"` : `Notes: (none)`);

  const userPrompt = dataLines.join("\n");

  const model = gemini().getGenerativeModel({
    model: MODELS.FAST,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
    },
  });

  const res = await model.generateContent(userPrompt);
  const text = res.response.text();

  // Type-appropriate fallback copy if Gemini returns unparseable / invalid JSON.
  // Avoids the previous behavior where a parse failure on a strength workout
  // returned generic "monitor foot pain" copy.
  const fallback: SummarizeResult = (() => {
    switch (type) {
      case "strength":
        return {
          summary: "Strength session logged. Track your lifts week-over-week in Analytics.",
          adjustments: [
            "Keep RPE in the 7-8 range for productive strength work.",
            "If a lift feels off, drop the load before dropping the rep.",
          ],
        };
      case "mobility":
        return {
          summary: "Mobility session logged. Consistent mobility work protects your training.",
          adjustments: [
            "Tomorrow: pair this mobility focus with the next run or lift.",
            "Note any persistent restrictions so we can target them next session.",
          ],
        };
      case "other":
        return {
          summary: "Workout logged.",
          adjustments: [
            "Tell me more about this session next time so I can plan around it.",
            "Stay consistent with your training schedule.",
          ],
        };
      default:
        return {
          summary: "Workout logged. Keep monitoring foot pain and adjust intensity as needed.",
          adjustments: ["Review pain levels daily.", "Maintain current training volume."],
        };
    }
  })();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fallback;
  }
  try {
    return SummarizeResultSchema.parse(parsed);
  } catch {
    return fallback;
  }
}
