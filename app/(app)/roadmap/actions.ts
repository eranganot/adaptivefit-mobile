"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { trainingRoadmap, userLevelState, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";
import type { SessionPlan } from "@/lib/coach";

export async function regenerateRoadmap(userId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Unauthorized");
  }

  await regenerateRoadmapForUser(userId);
  revalidatePath("/roadmap");
}

/** Regenerate roadmap for the currently signed-in user (no userId param needed). */
export async function regenerateMyRoadmap(): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    await regenerateRoadmapForUser(user.id);
    revalidatePath("/roadmap");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("[regenerateMyRoadmap] error:", e);
    return { success: false, error: "Failed to regenerate. Please try again." };
  }
}

/**
 * Manually set the user's coach level.
 * Sets manual_override = true with a 7-day expiry window, then regenerates the roadmap.
 */
export async function setManualLevel(
  level: number,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const clampedLevel = Math.min(10, Math.max(1, Math.round(level)));
    const overrideUntil = new Date();
    overrideUntil.setDate(overrideUntil.getDate() + 7);

    const existing = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    });

    if (!existing) {
      await db.insert(userLevelState).values({
        userId: user.id,
        currentLevel: clampedLevel,
        greenSessionCount: 0,
        freezeActive: false,
        lastEvaluatedAt: new Date(),
        manualOverride: true,
        manualOverrideUntil: overrideUntil,
      });
    } else {
      await db
        .update(userLevelState)
        .set({
          currentLevel: clampedLevel,
          greenSessionCount: 0,
          manualOverride: true,
          manualOverrideUntil: overrideUntil,
          lastEvaluatedAt: new Date(),
        })
        .where(eq(userLevelState.userId, user.id));
    }

    await regenerateRoadmapForUser(user.id);

    revalidatePath("/roadmap");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("[setManualLevel] error:", e);
    return { success: false, error: "Failed to set level. Please try again." };
  }
}

/**
 * Add a custom session to the roadmap. Stamped source='manual' so the
 * auto-regenerator never deletes it. Use for one-off workouts that don't fit
 * the standard Tue/Fri template (e.g. weekend long runs, makeup sessions).
 *
 * Inputs:
 *   targetDate — ISO YYYY-MM-DD, must be today or future
 *   title — display title for the card
 *   distanceKm — for run blocks
 *   paceSecPerKm — pace in seconds per km (e.g. 435 = 7:15/km)
 *   notes — optional rationale shown in the Coach Insight Card
 */
export async function addManualRoadmapSession(input: {
  targetDate: string;
  title: string;
  distanceKm: number;
  paceSecPerKm: number;
  notes?: string;
}): Promise<{ success: true; sessionId: string } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };
    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    // Compute weekIndex / dayIndex relative to this Monday
    const today = new Date();
    const dow = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const targetDateObj = new Date(input.targetDate);
    targetDateObj.setHours(0, 0, 0, 0);
    const todayMidnight = new Date(today);
    todayMidnight.setHours(0, 0, 0, 0);
    if (targetDateObj < todayMidnight) {
      return { success: false, error: "Cannot schedule in the past." };
    }

    const daysDiff = Math.round(
      (targetDateObj.getTime() - startOfWeek.getTime()) / (1000 * 60 * 60 * 24),
    );
    const weekIndex = Math.floor(daysDiff / 7);
    const dayIndex = daysDiff % 7;

    const plan: SessionPlan = {
      title: input.title.trim() || "Custom session",
      blocks: [
        {
          kind: "run_block",
          distanceKm: input.distanceKm,
          paceSecPerKm: input.paceSecPerKm,
          reps: 1,
          recoverySec: 0,
        },
      ],
      rationale: input.notes?.trim() || "Manually added by you.",
    };

    const [row] = await db
      .insert(trainingRoadmap)
      .values({
        userId: user.id,
        goalId: null,
        weekIndex,
        dayIndex,
        sessionPlan: plan,
        status: "pending" as const,
        source: "manual" as const, // Survives auto-regen
      })
      .returning({ id: trainingRoadmap.id });

    revalidatePath("/roadmap");
    revalidatePath("/home");
    return { success: true, sessionId: row.id };
  } catch (e) {
    console.error("[addManualRoadmapSession] error:", e);
    return { success: false, error: "Failed to add session." };
  }
}

/**
 * Delete a specific pending roadmap session (e.g. to remove a misplaced workout).
 */
export async function deleteRoadmapSession(
  sessionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    await db
      .delete(trainingRoadmap)
      .where(and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, user.id)));

    revalidatePath("/roadmap");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("[deleteRoadmapSession] error:", e);
    return { success: false, error: "Failed to delete session." };
  }
}

/**
 * Update a roadmap session's scheduled date and/or title.
 * newDate: ISO date string "YYYY-MM-DD" — converted to weekIndex/dayIndex relative to this Monday.
 * newTitle: optional replacement for sessionPlan.title.
 */
export async function updateRoadmapSession(
  sessionId: string,
  updates: { newDate?: string; newTitle?: string },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    // Fetch existing row
    const row = await db.query.trainingRoadmap.findFirst({
      where: and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, user.id)),
    });
    if (!row) return { success: false, error: "Session not found." };

    const setValues: Partial<typeof trainingRoadmap.$inferInsert> = {};

    // Compute new weekIndex / dayIndex from the chosen date
    if (updates.newDate) {
      const today = new Date();
      const dow = today.getDay();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
      startOfWeek.setHours(0, 0, 0, 0);

      const newDateObj = new Date(updates.newDate);
      newDateObj.setHours(0, 0, 0, 0);
      const daysDiff = Math.round(
        (newDateObj.getTime() - startOfWeek.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysDiff < 0) return { success: false, error: "Cannot schedule in the past." };

      setValues.weekIndex = Math.floor(daysDiff / 7);
      setValues.dayIndex = daysDiff % 7;
    }

    // Patch the title inside the JSONB sessionPlan
    if (updates.newTitle?.trim()) {
      const plan = row.sessionPlan as SessionPlan;
      setValues.sessionPlan = { ...plan, title: updates.newTitle.trim() };
    }

    if (Object.keys(setValues).length > 0) {
      await db
        .update(trainingRoadmap)
        .set(setValues)
        .where(and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, user.id)));
    }

    revalidatePath("/roadmap");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("[updateRoadmapSession] error:", e);
    return { success: false, error: "Failed to update session." };
  }
}
