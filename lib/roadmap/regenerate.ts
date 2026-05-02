import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import type { CoachInputs } from "@/lib/coach";

/**
 * Core regeneration logic — shared between the roadmap server action and
 * logManualWorkout (which triggers a regen after a freeze or level promotion).
 *
 * Deletes all pending roadmap rows for the user and generates 2 fresh weeks
 * of sessions (Tue/Fri pattern) based on the current coach state.
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

  const userState: CoachInputs["state"] = {
    currentLevel: 1,
    greenSessionCount: 0,
    freezeActive: false,
    freezeReason: null,
  };

  const sessionsToCreate = [];

  for (let weekIdx = 0; weekIdx < 2; weekIdx++) {
    // Tuesday (dayIndex 1)
    const tuePlan = evaluateCoach({ recentLogs, state: userState, today: new Date() }).todayPlan;
    sessionsToCreate.push({
      userId,
      goalId: null,
      weekIndex: weekIdx,
      dayIndex: 1,
      sessionPlan: tuePlan,
      status: "pending" as const,
      createdAt: new Date(),
    });

    // Friday (dayIndex 4)
    const friPlan = evaluateCoach({ recentLogs, state: userState, today: new Date() }).todayPlan;
    sessionsToCreate.push({
      userId,
      goalId: null,
      weekIndex: weekIdx,
      dayIndex: 4,
      sessionPlan: friPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });
  }

  if (sessionsToCreate.length > 0) {
    await db.insert(trainingRoadmap).values(sessionsToCreate);
  }
}
