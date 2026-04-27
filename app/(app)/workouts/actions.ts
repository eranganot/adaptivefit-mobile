"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workoutLogs,
  feedbackSentiment,
  userLevelState,
  users,
} from "@/lib/db/schema";
import { eq, desc, gte, and, inArray } from "drizzle-orm";
import { extractFeedback } from "@/lib/gemini/extractFeedback";
import { evaluateCoach } from "@/lib/coach";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const LogWorkoutSchema = z.object({
  type: z.enum(["run", "strength", "mobility", "other"]),
  performedAt: z.string(),
  distanceKm: z.number().positive().optional(),
  durationMin: z.number().positive().optional(),
  rpe: z.number().int().min(1).max(10),
  footPain: z.number().int().min(0).max(10),
  otherPain: z.string().optional(),
  notes: z.string().optional(),
});

export type LogWorkoutInput = z.infer<typeof LogWorkoutSchema>;

export async function logWorkout(
  input: LogWorkoutInput,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const validated = LogWorkoutSchema.parse(input);

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    // ── 1. Insert workout log ─────────────────────────────────────────────
    const [log] = await db
      .insert(workoutLogs)
      .values({
        userId: user.id,
        performedAt: new Date(validated.performedAt),
        type: validated.type,
        distanceKm: validated.distanceKm?.toString() ?? null,
        durationSec: validated.durationMin
          ? Math.round(validated.durationMin * 60)
          : null,
        rpe: validated.rpe,
        footPain: validated.footPain,
        otherPain: validated.otherPain || null,
        notesRaw: validated.notes || null,
      })
      .returning();

    // ── 2. Gemini feedback extraction (non-fatal) ─────────────────────────
    try {
      const extraction = await extractFeedback({
        notes: validated.notes,
        type: validated.type,
        distanceKm: validated.distanceKm,
        durationSec: validated.durationMin
          ? Math.round(validated.durationMin * 60)
          : undefined,
        rpe: validated.rpe,
        footPain: validated.footPain,
      });

      await db.insert(feedbackSentiment).values({
        workoutLogId: log.id,
        overallSentiment: extraction.data.overall_sentiment,
        symptoms: extraction.data.symptoms,
        severity: extraction.data.severity,
        aiSummaryEn: extraction.data.ai_summary_en,
        aiSummaryHe: extraction.data.ai_summary_he,
        geminiModel: extraction.modelUsed,
      });

      // Update locale detection from Gemini
      if (extraction.data.detected_locale) {
        await db
          .update(workoutLogs)
          .set({ notesLocale: extraction.data.detected_locale })
          .where(eq(workoutLogs.id, log.id));
      }
    } catch (e) {
      console.error("[logWorkout] Gemini extraction failed (skipping):", e);
    }

    // ── 3. Load recent logs for coach evaluation ──────────────────────────
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentLogs = await db
      .select()
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, user.id),
          gte(workoutLogs.performedAt, fourteenDaysAgo),
        ),
      )
      .orderBy(desc(workoutLogs.performedAt))
      .limit(20);

    const sentiments =
      recentLogs.length > 0
        ? await db
            .select()
            .from(feedbackSentiment)
            .where(
              inArray(
                feedbackSentiment.workoutLogId,
                recentLogs.map((l) => l.id),
              ),
            )
        : [];

    const sentimentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
    const logsWithSentiment = recentLogs.map((l) => ({
      ...l,
      sentiment: sentimentMap.get(l.id) ?? null,
    }));

    // ── 4. Run coach & upsert state ───────────────────────────────────────
    const currentState = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    });

    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: currentState ?? {
        userId: user.id,
        currentLevel: 1,
        greenSessionCount: 0,
        freezeActive: false,
        freezeReason: null,
        lastEvaluatedAt: null,
      },
      today: new Date(),
    });

    await db
      .insert(userLevelState)
      .values({
        userId: user.id,
        currentLevel: coachResult.newState.currentLevel,
        greenSessionCount: coachResult.newState.greenSessionCount,
        freezeActive: coachResult.newState.freezeActive,
        freezeReason: coachResult.newState.freezeReason,
        lastEvaluatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userLevelState.userId,
        set: {
          currentLevel: coachResult.newState.currentLevel,
          greenSessionCount: coachResult.newState.greenSessionCount,
          freezeActive: coachResult.newState.freezeActive,
          freezeReason: coachResult.newState.freezeReason,
          lastEvaluatedAt: new Date(),
        },
      });

    revalidatePath("/home");
    revalidatePath("/workouts");

    return { success: true };
  } catch (e) {
    console.error("[logWorkout] error:", e);
    return { success: false, error: "Failed to save workout. Please try again." };
  }
}
