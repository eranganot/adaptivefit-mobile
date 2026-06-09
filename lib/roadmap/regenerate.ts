import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, userLevelState, goals, fitSessions } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import type { CoachInputs, GoalCategory } from "@/lib/coach";
import { periodize } from "@/lib/coach/periodize";
import { summarizeExternalActivity } from "@/lib/coach/externalActivity";

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
  // Non-destructive regen: only delete rows we created ourselves (source='auto').
  // Manually-added sessions and coach-proposed adjustments survive every regen.
  await db
    .delete(trainingRoadmap)
    .where(
      and(
        eq(trainingRoadmap.userId, userId),
        eq(trainingRoadmap.status, "pending"),
        eq(trainingRoadmap.source, "auto"),
      ),
    );

  const last8Weeks = new Date();
  last8Weeks.setDate(last8Weeks.getDate() - 56);
  const last30Days = new Date(Date.now() - 30 * 86_400_000);

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

  // External sessions for FSM visibility — same 30d window the chat coach
  // uses. evaluateCoach doesn't change plan logic on this signal, but it
  // surfaces a rules_applied audit entry per call so we can tell whether
  // the FSM had context. Non-fatal: regen still runs with workout_logs alone.
  // Run after the main Promise.all so a fit_sessions query failure doesn't
  // reject the whole batch.
  let externalActivity: ReturnType<typeof summarizeExternalActivity> | undefined;
  try {
    const externalRows = await db
      .select({
        startTime: fitSessions.startTime,
        endTime: fitSessions.endTime,
        distanceM: fitSessions.distanceM,
        sourceApp: fitSessions.sourceApp,
        userClassification: fitSessions.userClassification,
      })
      .from(fitSessions)
      .where(and(eq(fitSessions.userId, userId), gte(fitSessions.endTime, last30Days)));
    externalActivity = summarizeExternalActivity(externalRows, last30Days, new Date());
  } catch (err) {
    console.warn("[regenerateRoadmap] external activity summary failed:", err);
  }

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

  // Compute today's day-of-week as Sun=0..Sat=6 (week anchor = Sunday) so we
  // can skip past sessions in week 0 (regen often runs mid-week → Tuesday may
  // already be in the past). getDay() is already Sun=0, so no remap needed.
  const todayDayIndex = new Date().getDay(); // Sun=0..Sat=6

  for (let weekIdx = 0; weekIdx < 2; weekIdx++) {
    const pd = periodize({ weekIndex: weekIdx, targetDate });

    // Tuesday (dayIndex 2 under Sun-anchored weeks) — quality / push day.
    // Skip if Tue is already past in week 0.
    if (weekIdx > 0 || todayDayIndex <= 2) {
      const tueResult = evaluateCoach({
        recentLogs,
        state: simulatedState,
        today: new Date(),
        sessionKind: "quality",
        goalCategory,
        periodize: { volumeMultiplier: pd.volumeMultiplier, levelOffset: pd.levelOffset },
        externalActivity,
      });
      sessionsToCreate.push({
        userId,
        goalId: activeGoal?.id ?? null,
        weekIndex: weekIdx,
        dayIndex: 2, // Tuesday (Sun=0 anchor)
        sessionPlan: tueResult.todayPlan,
        status: "pending" as const,
        source: "auto" as const,
        createdAt: new Date(),
      });
      simulatedState = advanceState(simulatedState, tueResult.newState);
    }

    // Friday (dayIndex 5 under Sun-anchored weeks) — endurance / pull+legs day.
    // Skip if Fri is already past in week 0.
    if (weekIdx > 0 || todayDayIndex <= 5) {
      const friResult = evaluateCoach({
        recentLogs,
        state: simulatedState,
        today: new Date(),
        sessionKind: "endurance",
        goalCategory,
        periodize: { volumeMultiplier: pd.volumeMultiplier, levelOffset: pd.levelOffset },
        externalActivity,
      });
      sessionsToCreate.push({
        userId,
        goalId: activeGoal?.id ?? null,
        weekIndex: weekIdx,
        dayIndex: 5, // Friday (Sun=0 anchor)
        sessionPlan: friResult.todayPlan,
        status: "pending" as const,
        source: "auto" as const,
        createdAt: new Date(),
      });
      simulatedState = advanceState(simulatedState, friResult.newState);
    }
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
