/**
 * Post-workout analysis via Gemini.
 * Takes structured workout data (RPE, pain, notes, level) and returns coach feedback.
 */
import { z } from "zod";
import { gemini, MODELS } from "./client";

export const SummarizeResultSchema = z.object({
  summary: z.string().max(500),
  adjustments: z.array(z.string()).min(2).max(4),
});
export type SummarizeResult = z.infer<typeof SummarizeResultSchema>;

export type SummarizeInput = {
  rpe: number;
  footPain: number;
  notes: string;
  currentLevel: number;
  recentRpe: number[];
};

const SYSTEM_PROMPT = `You are a conservative running coach assistant for an athlete recovering from plantar fasciitis. 
Given a workout's RPE, foot pain, and free-text notes, provide a brief analysis and concrete next steps.

Output ONLY a JSON object with this exact schema (no markdown, no commentary):
{
  "summary": "string, 3-4 sentences of analysis",
  "adjustments": ["string", "string", "string or 4"]
}

Guidelines:
- Keep summary friendly and specific to the athlete's data.
- If pain >= 7 or RPE >= 9: mention rest/freeze in summary.
- If pain <= 2 and RPE <= 7: mention progression opportunity in summary.
- Adjustments should be concrete, actionable changes (1 sentence each).
- If no notes provided, reference only RPE and pain.`;

export async function summarizePostWorkout(input: SummarizeInput): Promise<SummarizeResult> {
  const recentTrendStr = input.recentRpe.length > 0
    ? ` (recent trend: avg ${(input.recentRpe.reduce((a, b) => a + b, 0) / input.recentRpe.length).toFixed(1)}/10)`
    : "";

  const userPrompt = [
    `RPE: ${input.rpe}/10${recentTrendStr}`,
    `Foot pain: ${input.footPain}/10`,
    `Athlete level: ${input.currentLevel}`,
    input.notes.trim() ? `Notes: "${input.notes}"` : `Notes: (none)`,
  ].join("\n");

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback on JSON parse error
    return {
      summary: "Workout logged. Keep monitoring foot pain and adjust intensity as needed.",
      adjustments: [
        "Review pain levels daily.",
        "Maintain current training volume.",
      ],
    };
  }

  try {
    return SummarizeResultSchema.parse(parsed);
  } catch {
    // Fallback on schema validation error
    return {
      summary: "Workout logged. Keep monitoring foot pain and adjust intensity as needed.",
      adjustments: [
        "Review pain levels daily.",
        "Maintain current training volume.",
      ],
    };
  }
}
