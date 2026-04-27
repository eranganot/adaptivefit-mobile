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
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You are a sports physiotherapy assistant. Given a runner's post-workout free-text feedback, extract structured signals.

Output ONLY a JSON object matching this schema (no markdown fences, no commentary):
{
  "overall_sentiment": "positive"|"neutral"|"concern",
  "symptoms": string[],   // subset of the controlled vocabulary below
  "severity": 0-10,        // higher = more concerning
  "ai_summary_en": string, // <=30 words, English
  "ai_summary_he": string, // <=30 words, Hebrew
  "detected_locale": "en"|"he"
}

Allowed symptom tokens (English ids only — never translate):
plantar_fascia, breathing_dereg, form_breakdown, knee_pain, hip_pain, back_pain, low_energy, nausea, cramp, motivated, controlled.

Be conservative — only flag symptoms clearly stated or strongly implied. If the input is empty, return overall_sentiment="neutral", symptoms=[], severity=0, summaries="No feedback recorded".`;

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
  } catch (err) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const data = ExtractionSchema.parse(parsed);
  return { data, modelUsed: MODELS.FAST };
}
