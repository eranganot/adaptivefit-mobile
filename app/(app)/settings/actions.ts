"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, userLevelState, fitDailyMetrics, fitSessions } from "@/lib/db/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { FitDailyAggregate, FitSessionSummary } from "@/lib/fit/types";
import { deriveActiveMinutesByDay } from "@/lib/fit/deriveActiveMinutes";

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
 * Phase 8b: also accepts `sessions[]` (ExerciseSessionRecord summaries) and
 * upserts them into `fit_sessions`. Sessions are workouts originally recorded
 * by external apps (Strava, Samsung Health, etc.) that the user shares with
 * AdaptiveFit via Health Connect. AdaptiveFit's own GPS-tracked runs are NOT
 * in this stream — they live in `run_sessions` and remain authoritative for
 * AF workouts.
 *
 * Callers that still pass the old `days`-only array stay supported for one
 * release — see the input-shape normalisation below.
 *
 * Web callers get a no-op result (Health Connect is Android-only).
 */
type SyncInput =
  | FitDailyAggregate[]                                          // legacy shape
  | { days: FitDailyAggregate[]; sessions?: FitSessionSummary[] };

export async function syncHealthConnectData(
  input: SyncInput,
): Promise<{
  success: boolean;
  daysFetched?: number;
  sessionsFetched?: number;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    // Accept both the legacy bare-array shape and the new object shape so
    // an old client APK on someone's phone doesn't error after this deploy.
    const days: FitDailyAggregate[] = Array.isArray(input)
      ? input
      : input.days ?? [];
    const sessions: FitSessionSummary[] = Array.isArray(input)
      ? []
      : input.sessions ?? [];

    if (days.length === 0 && sessions.length === 0) {
      return { success: true, daysFetched: 0, sessionsFetched: 0 };
    }

    // ── Daily aggregates ──────────────────────────────────────────
    let daysWritten = 0;
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
      daysWritten += 1;
    }

    // ── ExerciseSession records (Phase 8b) ────────────────────────
    // Upsert keyed on (user_id, fit_session_id). fit_session_id is the
    // Health Connect record id when available; readSessions falls back to a
    // deterministic hash so re-reads upsert cleanly rather than duplicating.
    let sessionsWritten = 0;
    for (const s of sessions) {
      if (!s.fitSessionId || !s.startTime || !s.endTime) continue;
      try {
        await db
          .insert(fitSessions)
          .values({
            userId: user.id,
            fitSessionId: s.fitSessionId,
            activityType: s.activityType,
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
            distanceM: s.distanceM,
            avgHr: s.avgHr,
            maxHr: s.maxHr,
            steps: s.steps,
            calories: s.calories,
            sourceApp: s.sourceApp,
          })
          .onConflictDoUpdate({
            target: [fitSessions.userId, fitSessions.fitSessionId],
            set: {
              activityType: s.activityType,
              startTime: new Date(s.startTime),
              endTime: new Date(s.endTime),
              distanceM: s.distanceM,
              avgHr: s.avgHr,
              maxHr: s.maxHr,
              steps: s.steps,
              calories: s.calories,
              sourceApp: s.sourceApp,
            },
          });
        sessionsWritten += 1;
      } catch (e) {
        // Per-session failures shouldn't kill the whole sync. Log and
        // continue — most likely cause is a row with an out-of-range
        // activityType from a future HC plugin version.
        console.warn("[syncHealthConnectData] session upsert failed:", s.fitSessionId, e);
      }
    }

    // ── Active-minutes derivation (Phase 8b polish #1) ────────────
    // HC doesn't surface "active minutes" as a separate aggregate the way
    // legacy Google Fit did. We derive it from ExerciseSession durations:
    // for each UTC day in the sync window, sum the durations of any
    // sessions overlapping that day (split at midnight). Pull ALL sessions
    // in the window from DB (not just the ones in this sync's payload) so
    // a day with only pre-existing sessions still gets its active_minutes
    // recomputed correctly.
    //
    // Range: the daily-aggregates payload defines the window we care about
    // — if days[] is empty (sessions-only sync) we fall back to a 30-day
    // window to keep the work bounded.
    try {
      let windowStart: Date;
      let windowEnd: Date;
      if (days.length > 0) {
        const dates = days.map((d) => new Date(`${d.date}T00:00:00.000Z`));
        windowStart = new Date(Math.min(...dates.map((d) => d.getTime())));
        windowEnd = new Date(Math.max(...dates.map((d) => d.getTime())));
        // Extend windowEnd to end-of-day UTC so a session ending late on
        // that date is included in the query.
        windowEnd.setUTCHours(23, 59, 59, 999);
      } else {
        windowEnd = new Date();
        windowStart = new Date(windowEnd);
        windowStart.setUTCDate(windowStart.getUTCDate() - 30);
      }

      // Sessions whose [startTime, endTime] window overlaps [windowStart,
      // windowEnd]. Strict overlap: a session ending exactly at windowStart
      // or starting exactly at windowEnd contributes nothing useful, but
      // the inclusive bounds are simpler and the no-op math drops them
      // inside the derivation helper.
      const sessionRows = await db
        .select({
          startTime: fitSessions.startTime,
          endTime: fitSessions.endTime,
        })
        .from(fitSessions)
        .where(
          and(
            eq(fitSessions.userId, user.id),
            lte(fitSessions.startTime, windowEnd),
            gte(fitSessions.endTime, windowStart),
          ),
        );

      const minutesByDay = deriveActiveMinutesByDay(sessionRows);

      // Upsert the derived value per day. Don't touch other columns —
      // they were just set by the daily-aggregates pass above and we
      // don't want to clobber them with nulls.
      for (const [date, minutes] of minutesByDay) {
        await db
          .insert(fitDailyMetrics)
          .values({
            userId: user.id,
            date,
            activeMinutes: minutes,
          })
          .onConflictDoUpdate({
            target: [fitDailyMetrics.userId, fitDailyMetrics.date],
            set: {
              activeMinutes: minutes,
              updatedAt: new Date(),
            },
          });
      }
    } catch (e) {
      // Non-fatal — daily aggregates + sessions are already written.
      // Logging here surfaces it in Railway if derivation breaks.
      console.warn("[syncHealthConnectData] active-minutes derivation failed:", e);
    }

    revalidatePath("/home");
    revalidatePath("/settings");
    // The Daily Activity chart on Analytics consumes
    // fit_daily_metrics.active_minutes (derived above) — without this
    // revalidate, the chart serves stale data until the next route push.
    revalidatePath("/analytics");
    return { success: true, daysFetched: daysWritten, sessionsFetched: sessionsWritten };
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
