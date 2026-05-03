"use server";

/**
 * Shared post-write pipeline: runs after any insert, update, or delete on
 * workout_logs so that coach FSM state and roadmap stay consistent.
 *
 * Call this at the end of logManualWorkout, updateWorkout, and deleteWorkout.
 */

import { db } from "@/lib/db";
import {
  workoutLogs,
  feedbackSentiment,
  userLevelState,
} from "@/lib/db/schema";
import { eq, desc, gte, and, inArray } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";

export async function recomputeAfterChange(userId: string): Promise<void> {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const [stateRow, recentRaw] = await Promise.all([
      db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, userId) }),
      db
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.userId, userId), gte(workoutLogs.performedAt, fourteenDaysAgo)))
        .orderBy(desc(workoutLogs.performedAt))
        .limit(20),
    ]);

    const sentiments =
      recentRaw.length > 0
        ? await db
            .select()
            .from(feedbackSentiment)
            .where(inArray(feedbackSentiment.workoutLogId, recentRaw.map((l) => l.id)))
        : [];

    const sentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
    const logsWithSentiment = recentRaw.map((l) => ({ ...l, sentiment: sentMap.get(l.id) ?? null }));

    const prevLevel = stateRow?.currentLevel ?? 1;
    const prevFreeze = stateRow?.freezeActive ?? false;

    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: stateRow ?? {
        userId,
        currentLevel: 1,
        greenSessionCount: 0,
        freezeActive: false,
        freezeReason: null,
        lastEvaluatedAt: null,
      },
      today: new Date(),
    });

    const { currentLevel, greenSessionCount, freezeActive, freezeReason } = coachResult.newState;

    await db
      .insert(userLevelState)
      .values({ userId, currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() })
      .onConflictDoUpdate({
        target: userLevelState.userId,
        set: { currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() },
      });

    const shouldRegen =
      (freezeActive && !prevFreeze) ||
      (!freezeActive && prevFreeze) ||
      currentLevel !== prevLevel;

    if (shouldRegen) {
      try {
        await regenerateRoadmapForUser(userId);
      } catch (e) {
        console.error("[recomputeAfterChange] regenerateRoadmap non-fatal:", e);
      }
    }
  } catch (e) {
    console.error("[recomputeAfterChange] error:", e);
    // Non-fatal — caller already mutated the record
  }
}
