/**
 * Cold-start analysis — run once on first Google Fit connect.
 * Pulls last 14 days of Fit data, asks Gemini for a recommended starting Level,
 * stores the result in cold_start_analysis, and pre-fills user_level_state.
 */
import { db } from "@/lib/db";
import {
  fitDailyMetrics,
  fitSessions,
  coldStartAnalysis,
  userLevelState,
} from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { gemini, MODELS } from "@/lib/gemini/client";

export interface ColdStartResult {
  recommendedLevel: number;
  rationale: string;
}

export async function runColdStart(userId: string): Promise<ColdStartResult> {
  // Pull last 14 days of daily metrics
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const [dailyRows, sessionRows] = await Promise.all([
    db.select().from(fitDailyMetrics).where(
      and(eq(fitDailyMetrics.userId, userId), gte(fitDailyMetrics.date, cutoffDate)),
    ),
    db.select().from(fitSessions).where(
      and(eq(fitSessions.userId, userId), gte(fitSessions.startTime, cutoff)),
    ),
  ]);

  // Build a concise summary for Gemini
  const totalDays = dailyRows.length;
  const activeDays = dailyRows.filter((d) => (d.activeMinutes ?? 0) > 0).length;
  const avgSteps = totalDays > 0
    ? Math.round(dailyRows.reduce((s, d) => s + (d.steps ?? 0), 0) / totalDays)
    : 0;
  const totalDistanceKm = Math.round(
    sessionRows.reduce((s, r) => s + (r.distanceM ?? 0), 0) / 1000,
  );
  const avgHr = sessionRows.filter((r) => r.avgHr).length > 0
    ? Math.round(
        sessionRows.reduce((s, r) => s + (r.avgHr ?? 0), 0) /
          sessionRows.filter((r) => r.avgHr).length,
      )
    : null;

  const summary = `
Last 14 days of activity data for a runner:
- Active days: ${activeDays} / ${totalDays}
- Average daily steps: ${avgSteps.toLocaleString()}
- Total running distance: ${totalDistanceKm} km across ${sessionRows.length} session(s)
- Average running HR: ${avgHr ? `${avgHr} bpm` : "not available"}

The app uses a conservative Level 1-10 system where:
- Level 1-2: beginner, 1-2 runs/week, 1-3 km each
- Level 3-4: casual runner, 2-3 runs/week, 3-5 km each
- Level 5-6: regular runner, 3-4 runs/week, 5-8 km each
- Level 7-8: experienced runner, 4-5 runs/week, 8-12 km each
- Level 9-10: advanced, 5+ runs/week, 12+ km each

Recommend a starting level (respond with JSON only):
{"level": <1-10>, "rationale": "<one sentence>"}
`.trim();

  let recommendedLevel = 1;
  let rationale = "Starting conservatively based on limited data.";

  try {
    const model = gemini().getGenerativeModel({
      model: MODELS.FAST,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 100,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(summary);
    const text = result.response.text().trim();
    const parsed = JSON.parse(text) as { level?: number; rationale?: string };
    recommendedLevel = Math.min(10, Math.max(1, Math.round(parsed.level ?? 1)));
    rationale = parsed.rationale ?? rationale;
  } catch (e) {
    console.error("Cold-start Gemini call failed:", e);
    // Fall back to a heuristic
    if (totalDistanceKm > 40) recommendedLevel = 6;
    else if (totalDistanceKm > 20) recommendedLevel = 4;
    else if (totalDistanceKm > 5) recommendedLevel = 2;
  }

  // Persist to cold_start_analysis with status 'pending' — user must accept/override via UI
  await db.insert(coldStartAnalysis).values({
    userId,
    source: "gemini_import",
    rawInput: summary,
    extracted: { recommendedLevel, rationale, avgSteps, totalDistanceKm, avgHr },
    recommendedLevel,
    status: "pending",
  }).onConflictDoNothing();

  // NOTE: We deliberately do NOT auto-apply to userLevelState here.
  // The acceptColdStart server action does that once the user reviews the recommendation.

  return { recommendedLevel, rationale };
}
