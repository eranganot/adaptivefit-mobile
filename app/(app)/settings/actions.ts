"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, userLevelState, fitDailyMetrics } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { FitDailyAggregate } from "@/lib/fit/types";

export async function setLocale(locale: "en" | "he") {
  try {
    const session = await auth();
    
    if (!session?.user?.email) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user from DB by email
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email))
      .limit(1);

    if (!user || user.length === 0) {
      return { success: false, error: "User not found" };
    }

    const userId = user[0].id;

    // Update user locale in database
    await db
      .update(users)
      .set({ locale })
      .where(eq(users.id, userId));

    // Set locale cookie
    const cookieStore = await cookies();
    cookieStore.set("locale", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Revalidate to reflect changes
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Error setting locale:", error);
    return { success: false, error: "Failed to update locale" };
  }
}

// disconnectGoogleFit() was removed in Phase 8 — Google Fit REST API is
// deprecated and we migrated to Health Connect (no cloud auth to disconnect).
//
// Stale oauth_tokens rows with provider='google_fit' are harmless but you can
// purge them manually with:
//   DELETE FROM oauth_tokens WHERE provider = 'google_fit';

/**
 * Bug #9 — Manual level override.
 * Sets the user's training level directly, bypassing the FSM for up to 7 days.
 */
export async function setManualLevelOverride(
  level: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    const clampedLevel = Math.min(10, Math.max(1, Math.round(level)));
    const overrideUntil = new Date();
    overrideUntil.setDate(overrideUntil.getDate() + 7);

    const existing = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    });

    if (existing) {
      await db
        .update(userLevelState)
        .set({
          currentLevel: clampedLevel,
          manualOverride: true,
          manualOverrideUntil: overrideUntil,
          lastEvaluatedAt: new Date(),
        })
        .where(eq(userLevelState.userId, user.id));
    } else {
      await db.insert(userLevelState).values({
        userId: user.id,
        currentLevel: clampedLevel,
        greenSessionCount: 0,
        freezeActive: false,
        manualOverride: true,
        manualOverrideUntil: overrideUntil,
        lastEvaluatedAt: new Date(),
      });
    }

    revalidatePath("/settings");
    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("setManualLevelOverride error:", e);
    return { success: false, error: "Failed to update level" };
  }
}

/** Clear a manual level override — coach FSM resumes normally. */
export async function clearManualLevelOverride(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    await db
      .update(userLevelState)
      .set({ manualOverride: false, manualOverrideUntil: null })
      .where(eq(userLevelState.userId, user.id));

    revalidatePath("/settings");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("clearManualLevelOverride error:", e);
    return { success: false, error: "Failed to clear override" };
  }
}

/**
 * Sync data pre-read from Health Connect on the client.
 *
 * Phase 8 migration: replaces the old Google Fit REST flow. Health Connect
 * is on-device, so the client (native Capacitor shell on Android) reads the
 * raw aggregates and POSTs them here. This action upserts into the existing
 * `fit_daily_metrics` table so the rest of the app (home screen yesterday
 * widget, analytics) keeps working unchanged.
 *
 * Web callers get a no-op result (Health Connect is Android-only).
 */
export async function syncHealthConnectData(
  days: FitDailyAggregate[],
): Promise<{ success: boolean; daysFetched?: number; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    if (!Array.isArray(days) || days.length === 0) {
      return { success: true, daysFetched: 0 };
    }

    let written = 0;
    for (const d of days) {
      // Skip rows with no useful data — keeps the table compact.
      if (!d.steps && !d.distanceM && !d.activeMinutes && !d.avgHr && !d.calories) continue;

      await db
        .insert(fitDailyMetrics)
        .values({
          userId: user.id,
          date: d.date,
          steps: d.steps,
          distanceM: d.distanceM,
          activeMinutes: d.activeMinutes,
          avgHr: d.avgHr,
          calories: d.calories,
        })
        .onConflictDoUpdate({
          target: [fitDailyMetrics.userId, fitDailyMetrics.date],
          set: {
            steps: d.steps,
            distanceM: d.distanceM,
            activeMinutes: d.activeMinutes,
            avgHr: d.avgHr,
            calories: d.calories,
            updatedAt: new Date(),
          },
        });
      written += 1;
    }

    revalidatePath("/home");
    revalidatePath("/settings");
    return { success: true, daysFetched: written };
  } catch (e) {
    console.error("syncHealthConnectData error:", e);
    return { success: false, error: e instanceof Error ? e.message : "Failed to sync" };
  }
}

/**
 * Lightweight status query: when did Health Connect data last update?
 *
 * We don't keep a dedicated oauth_tokens row anymore (HC has no cloud auth).
 * Instead we derive "lastSyncAt" from the most recent fit_daily_metrics
 * updatedAt for this user. Returns null if nothing has ever synced.
 */
export async function getHealthConnectStatus(): Promise<{
  lastSyncAt: Date | null;
}> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { lastSyncAt: null };
    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { lastSyncAt: null };

    const latest = await db.query.fitDailyMetrics.findFirst({
      where: eq(fitDailyMetrics.userId, user.id),
      orderBy: [desc(fitDailyMetrics.updatedAt)],
      columns: { updatedAt: true },
    });
    return { lastSyncAt: latest?.updatedAt ?? null };
  } catch (e) {
    console.error("getHealthConnectStatus error:", e);
    return { lastSyncAt: null };
  }
}
