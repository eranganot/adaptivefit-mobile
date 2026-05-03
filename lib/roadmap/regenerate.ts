import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, userLevelState } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { evaluateCoach, buildSessionForLevel } from "@/lib/coach";
import type { CoachInputs } from "@/lib/coach";

/**
 * Core regeneration logic — shared between the roadmap server action and
 * logManualWorkout (which triggers a regen after a freeze or level promotion).
 *
 * Deletes all pending roadmap rows for the user and generates 2 fresh weeks
 * of sessions (Tue/Fri pattern) based on the current coach state.
 *
 * State is simulated forward across sessions so each session in the plan
 * builds on the previous one (progressive planning, Bug #3).
 */
export async function regenerateRoadmapForUser(userId: string): Promise<void> {
  // Delete pending rows for this user
  await db
    .delete(trainingRoadmap)
    .where(
      and(
        eq(trainingRoadmap.userId, userId),
        eq(trainingRoadmap.status, "pending"),
      ),
    );

  // Pull recent logs for coach evaluation
  const last14Days = new Date();
  last14Days.setDate(last14Days.getDate() - 14);

  const recentLogs = await db
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), gte(workoutLogs.performedAt, last14Days)))
    .orderBy(desc(workoutLogs.performedAt))
    .limit(20);

  // Read real user level state from DB (Bug #3 fix: was hardcoded to level 1)
  const stateRow = await db.query.userLevelState.findFirst({
    where: eq(userLevelState.userId, userId),
  });

  // Simulated state: starts from DB state and evolves across sessions
  let simulatedState: CoachInputs["state"] = stateRow
    ? {
        currentLevel: stateRow.currentLevel,
        greenSessionCount: stateRow.greenSessionCount,
        freezeActive: stateRow.freezeActive,
        freezeReason: stateRow.freezeReason,
        manualOverride: stateRow.manualOverride,
        manualOverrideUntil: stateRow.manualOverrideUntil,
      }
    : {
        currentLevel: 1,
        greenSessionCount: 0,
        freezeActive: false,
        freezeReason: null,
        manualOverride: false,
        manualOverrideUntil: null,
      };

  const sessionsToCreate = [];

  for (let weekIdx = 0; weekIdx < 2; weekIdx++) {
    // Tuesday — quality session (intervals)
    const tueResult = evaluateCoach({
      recentLogs,
      state: simulatedState,
      today: new Date(),
      sessionKind: "quality",
    });
    sessionsToCreate.push({
      userId,
      goalId: null,
      weekIndex: weekIdx,
      dayIndex: 1, // Tuesday
      sessionPlan: tueResult.todayPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });

    // Advance simulated state: assume this session is completed cleanly
    // (green session — RPE ≤ 7, pain ≤ 3), so greenSessionCount advances.
    // This makes Friday's plan build on Tuesday's simulated outcome.
    simulatedState = advanceState(simulatedState, tueResult.newState);

    // Friday — endurance session (longer continuous run)
    const friResult = evaluateCoach({
      recentLogs,
      state: simulatedState,
      today: new Date(),
      sessionKind: "endurance",
    });
    sessionsToCreate.push({
      userId,
      goalId: null,
      weekIndex: weekIdx,
      dayIndex: 4, // Friday
      sessionPlan: friResult.todayPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });

    // Advance state again for next week's Tuesday
    simulatedState = advanceState(simulatedState, friResult.newState);
  }

  if (sessionsToCreate.length > 0) {
    await db.insert(trainingRoadmap).values(sessionsToCreate);
  }
}

/**
 * Advance simulated state by merging the FSM result.
 * If the session was green (FSM didn't freeze), increment greenSessionCount.
 * If FSM promoted, carry the new level.
 */
function advanceState(
  prev: CoachInputs["state"],
  fsmResult: CoachInputs["state"],
): CoachInputs["state"] {
  // If FSM froze, propagate the freeze
  if (fsmResult.freezeActive) return fsmResult;

  // Otherwise simulate a clean session: bump greenSessionCount by 1
  const greens = Math.min((fsmResult.greenSessionCount ?? 0) + 1, 10);
  const promoted = greens >= 3 && (fsmResult.currentLevel ?? 1) < 10;

  return {
    ...fsmResult,
    greenSessionCount: promoted ? 0 : greens,
    currentLevel: promoted ? (fsmResult.currentLevel ?? 1) + 1 : (fsmResult.currentLevel ?? 1),
    freezeActive: false,
    freezeReason: null,
  };
}
