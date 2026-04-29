"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { evaluateCoach } from "@/lib/coach";
import type { CoachInputs } from "@/lib/coach";

export async function regenerateRoadmap(userId: string): Promise<void> {
  // Validate user is authenticated
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Unauthorized");
  }

  // Delete all pending roadmap rows for this user
  await db.delete(trainingRoadmap).where(
    and(
      eq(trainingRoadmap.userId, userId),
      eq(trainingRoadmap.status, "pending")
    )
  );

  // Get recent logs for coach evaluation
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

  // Generate 14 days: 2 sessions per week for 2 weeks (Tue/Fri pattern)
  const sessionsToCreate = [];

  for (let weekIdx = 0; weekIdx < 2; weekIdx++) {
    // Tuesday (day 1)
    const tuePlan = evaluateCoach({
      recentLogs,
      state: userState,
      today: new Date(),
    }).todayPlan;

    sessionsToCreate.push({
      userId,
      goalId: null,
      weekIndex: weekIdx,
      dayIndex: 1,
      sessionPlan: tuePlan,
      status: "pending" as const,
      createdAt: new Date(),
    });

    // Friday (day 4)
    const friPlan = evaluateCoach({
      recentLogs,
      state: userState,
      today: new Date(),
    }).todayPlan;

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

  revalidatePath("/roadmap");
}
