"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLevelState, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";

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
