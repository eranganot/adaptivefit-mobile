"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { coldStartAnalysis, userLevelState, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";

/**
 * Called on every Home page render for users with no userLevelState.
 * If neither a level-state row nor a pending cold-start exists yet,
 * inserts a default cold-start so the level-picker modal shows on first visit.
 */
export async function ensureColdStartExists(userId: string): Promise<void> {
  const [existingState, existingColdStart] = await Promise.all([
    db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, userId),
    }),
    db.query.coldStartAnalysis.findFirst({
      where: and(
        eq(coldStartAnalysis.userId, userId),
        eq(coldStartAnalysis.status, "pending"),
      ),
    }),
  ]);

  if (!existingState && !existingColdStart) {
    await db
      .insert(coldStartAnalysis)
      .values({
        userId,
        source: "manual_history",
        rawInput: "New user onboarding — no activity data yet.",
        extracted: {
          rationale:
            "Welcome! Pick your starting level so the coach can build the right plan for you. You can change this any time in Settings.",
        },
        recommendedLevel: 1,
        status: "pending",
      })
      .onConflictDoNothing();
  }
}

/** Returns the pending cold-start row for the current user, if any. */
export async function getPendingColdStart(): Promise<{
  id: string;
  recommendedLevel: number;
  rationale: string;
} | null> {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) return null;

  const row = await db.query.coldStartAnalysis.findFirst({
    where: and(
      eq(coldStartAnalysis.userId, user.id),
      eq(coldStartAnalysis.status, "pending"),
    ),
    orderBy: [desc(coldStartAnalysis.createdAt)],
  });

  if (!row || row.recommendedLevel == null) return null;

  const extracted = row.extracted as { rationale?: string };
  return {
    id: row.id,
    recommendedLevel: row.recommendedLevel,
    rationale: extracted?.rationale ?? "Based on your recent activity data.",
  };
}

/** User accepts or overrides the cold-start recommendation. */
export async function acceptColdStart(
  coldStartId: string,
  finalLevel: number,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const clampedLevel = Math.min(10, Math.max(1, Math.round(finalLevel)));

    // Fetch the cold start row to determine accepted vs overridden
    const row = await db.query.coldStartAnalysis.findFirst({
      where: and(
        eq(coldStartAnalysis.id, coldStartId),
        eq(coldStartAnalysis.userId, user.id),
      ),
    });
    if (!row) return { success: false, error: "Cold-start record not found" };

    const isOverride = row.recommendedLevel !== clampedLevel;

    await db
      .update(coldStartAnalysis)
      .set({
        status: isOverride ? "overridden" : "accepted",
        acceptedLevel: clampedLevel,
      })
      .where(eq(coldStartAnalysis.id, coldStartId));

    // Apply to userLevelState
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
        manualOverride: false,
      });
    } else {
      await db
        .update(userLevelState)
        .set({ currentLevel: clampedLevel, lastEvaluatedAt: new Date() })
        .where(eq(userLevelState.userId, user.id));
    }

    // Regenerate roadmap with the newly applied level
    await regenerateRoadmapForUser(user.id);

    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("[acceptColdStart] error:", e);
    return { success: false, error: "Failed to apply level. Please try again." };
  }
}
