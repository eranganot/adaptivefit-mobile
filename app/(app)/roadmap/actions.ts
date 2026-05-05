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
