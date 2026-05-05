import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, userLevelState, goals } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import type { CoachInputs, GoalCategory } from "@/lib/coach";
import { periodize } from "@/lib/coach/periodize";

/**
 * Core regeneration logic — shared between the roadmap server action and
 * logManualWorkout (which triggers a regen after a freeze or level promotion).
 *
 * Deletes all pending roadmap rows and generates 2 fresh weeks of sessions
 * (Tue/Fri pattern) based on current coach state and active goal category.
 *
 * State is simulated forward so each session builds on the previous one
 * (progressive planning, Bug #3).
 */
export async function regenerateRoadmapForUser(userId: string): Promise<void> {
  await db
    .delete(trainingRoadmap)
    .where(
      and(
        eq(trainingRoadmap.userId, userId),
        eq(trainingRoadmap.status, "pending"),
      ),
    );

  const last8Weeks = new Date();
  last8Weeks.setDate(last8Weeks.getDate() - 56);

  const [recentLogs, stateRow, allActiveGoals] = await Promise.all([
    db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), gte(workoutLogs.performedAt, last8Weeks)))
      .orderBy(desc(workoutLogs.performedAt))
      .limit(64),

    db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, userId),
    }),

    db.select().from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
      .orderBy(desc(goals.createdAt)),
  ]);

  // R3: Pick primary goal — running takes precedence (runner-first product), else most recent
  const CATEGORY_PRIORITY: Record<string, number> = { running: 0, weight_loss: 1, body_shape: 2, strength: 3 };
  const activeGoal = [...(allActiveGoals ?? [])].sort(
    (a, b) => (CATEGORY_PRIORITY[a.category] ?? 9) - (CATEGORY_PRIORITY[b.category] ?? 9),
  )[0] ?? null;

  const goalCategory: GoalCategory = (activeGoal?.category ?? "running") as GoalCategory;
  const targetDate: Date | null = activeGoal?.targetDate ? new Date(activeGoal.targetDate) : null;

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
    const pd = periodize({ weekIndex: weekIdx, targetDate });

    // Session 1 (Tue) — quality / push day
    const tueResult = evaluateCoach({
      recentLogs,
      state: simulatedState,
      today: new Date(),
      sessionKind: "quality",
      goalCategory,
      periodize: { volumeMultiplier: pd.volumeMultiplier, levelOffset: pd.levelOffset },
    });
    sessionsToCreate.push({
      userId,
      goalId: activeGoal?.id ?? null,
      weekIndex: weekIdx,
      dayIndex: 1, // Tuesday
      sessionPlan: tueResult.todayPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });
    simulatedState = advanceState(simulatedState, tueResult.newState);

    // Session 2 (Fri) — endurance / pull+legs day
    const friResult = evaluateCoach({
      recentLogs,
      state: simulatedState,
      today: new Date(),
      sessionKind: "endurance",
      goalCategory,
      periodize: { volumeMultiplier: pd.volumeMultiplier, levelOffset: pd.levelOffset },
    });
    sessionsToCreate.push({
      userId,
      goalId: activeGoal?.id ?? null,
      weekIndex: weekIdx,
      dayIndex: 4, // Friday
      sessionPlan: friResult.todayPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });
    simulatedState = advanceState(simulatedState, friResult.newState);
  }

  if (sessionsToCreate.length > 0) {
    await db.insert(trainingRoadmap).values(sessionsToCreate);
  }
}

function advanceState(
  prev: CoachInputs["state"],
  fsmResult: CoachInputs["state"],
): CoachInputs["state"] {
  if (fsmResult.freezeActive) return fsmResult;

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
