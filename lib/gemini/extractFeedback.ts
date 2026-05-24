/**
 * Extract structured signals from a workout's free-text feedback.
 * Bilingual EN/HE — locale auto-detected, summary returned in both languages.
 *
 * Adapted from eranganot/adaptivefit's NLP module.
 */
import { z } from "zod";
import { gemini, MODELS } from "./client";

export const SymptomSchema = z.enum([
  "plantar_fascia",
  "breathing_dereg",
  "form_breakdown",
  "knee_pain",
  "hip_pain",
  "back_pain",
  "low_energy",
  "nausea",
  "cramp",
  "motivated",
  "controlled",
]);
export type Symptom = z.infer<typeof SymptomSchema>;

export const ExtractionSchema = z.object({
  overall_sentiment: z.enum(["positive", "neutral", "concern"]),
  symptoms: z.array(SymptomSchema),
  severity: z.number().int().min(0).max(10),
  ai_summary_en: z.string().max(200),
  ai_summary_he: z.string().max(200),
  detected_locale: z.enum(["en", "he"]),
  /** Phase 8b.4: chat-extracted run metrics. Null when the notes don't
   *  mention them, when the workout isn't a run, or when the model is
   *  uncertain. Server-side, only used to back-fill workout_logs columns
   *  that the user left blank — never overwrites a value they typed. */
  extracted_distance_km: z.number().positive().max(500).nullable(),
  extracted_duration_sec: z.number().int().positive().max(86400).nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You are a sports physiotherapy assistant. Given a runner's post-workout free-text feedback, extract structured signals.

Output ONLY a JSON object matching this schema (no markdown fences, no commentary):
{
  "overall_sentiment": "positive"|"neutral"|"concern",
  "symptoms": string[],          // subset of the controlled vocabulary below
  "severity": 0-10,               // higher = more concerning
  "ai_summary_en": string,        // <=30 words, English
  "ai_summary_he": string,        // <=30 words, Hebrew
  "detected_locale": "en"|"he",
  "extracted_distance_km": number|null,    // distance THIS workout (km), or null
  "extracted_duration_sec": number|null    // duration THIS workout (sec), or null
}

Allowed symptom tokens (English ids only — never translate):
plantar_fascia, breathing_dereg, form_breakdown, knee_pain, hip_pain, back_pain, low_energy, nausea, cramp, motivated, controlled.

## Symptom extraction
Be conservative — only flag symptoms clearly stated or strongly implied. If the input is empty, return overall_sentiment="neutral", symptoms=[], severity=0, summaries="No feedback recorded".

## Run metrics extraction (extracted_distance_km / extracted_duration_sec)
ONLY extract when the notes describe what the athlete did in THIS session. Convert all units to km (distance) and seconds (duration).

Rules:
- "ran 7k", "7 km easy", "did 5k", "רצתי 7 קמ", "5 ק״מ" → extracted_distance_km = 7 (or 5, etc.)
- "5 miles", "ran 5mi" → extracted_distance_km = 8.05 (multiply by 1.60934)
- "45 minutes", "45 min", "45 דקות" → extracted_duration_sec = 2700
- "1 hour", "60 min", "שעה", "שעה ורבע" → 3600, 3600, 3600, 4500
- "ran 7k in 45 min" → both fields filled
- "fast 5k at 22:30" → distance 5, duration 22*60+30 = 1350
- "30 min easy" with no distance → duration only
- "easy 5k" with no time → distance only

Do NOT extract when:
- The note mentions a goal/target rather than the actual workout ("training for a 10k", "goal is sub-25 5k")
- The note refers to a previous session ("yesterday I ran 7k")
- Distance/time appears in a non-workout context ("ran out of water at 3km" — this is descriptive, not a total)
- Workout type is strength/mobility/other (only fill for runs; everything else returns null)
- Numbers are ambiguous ("did a long one" → null)
- The workout already has Distance and Duration provided in the structured context above — in that case the user has authoritative values, so return null for both extraction fields to avoid creating false signals.

When in doubt, return null. False positives here cause the analytics distance chart to silently lie.`;

export type ExtractionContext = {
  /** The user's free-text note (any language) */
  notes: string | null | undefined;
  /** Structured workout context — given to the model so summaries are accurate */
  type: "run" | "strength" | "mobility" | "other";
  distanceKm?: number | null;
  durationSec?: number | null;
  rpe: number;
  footPain: number;
};

export async function extractFeedback(ctx: ExtractionContext): Promise<{
  data: Extraction;
  modelUsed: string;
}> {
  const userPrompt = [
    `Workout type: ${ctx.type}`,
    ctx.distanceKm != null ? `Distance: ${ctx.distanceKm} km` : null,
    ctx.durationSec != null ? `Duration: ${ctx.durationSec} sec` : null,
    `RPE: ${ctx.rpe}/10`,
    `Foot pain: ${ctx.footPain}/10`,
    `Notes: ${(ctx.notes ?? "").trim() || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const model = gemini().getGenerativeModel({
    model: MODELS.FAST,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const res = await model.generateContent(userPrompt);
  const text = res.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const data = ExtractionSchema.parse(parsed);
  return { data, modelUsed: MODELS.FAST };
}
