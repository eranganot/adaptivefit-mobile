"use server";

/**
 * Server actions for the user's classification of external HC sessions as
 * training vs casual activity.
 *
 * The auto classifier in lib/coach/externalActivity.ts handles obvious
 * cases. Ambiguous sessions — brisk walks, mid-length casual jogs, hikes
 * — surface here for the user to label via the Home card or the chat
 * coach. The result is persisted on `fit_sessions.user_classification`
 * and consumed by the chart, FSM, and chat coach.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, fitSessions, workoutLogs } from "@/lib/db/schema";
import { eq, and, isNull, desc, gte, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  classifySessionSmart,
  dedupeOverlappingSessions,
} from "@/lib/coach/externalActivity";

export type PendingClassification = {
  id: string;
  startTime: Date;
  endTime: Date;
  distanceM: number | null;
  durationSec: number;
  sourceApp: string | null;
  /** Auto-classifier's reason — surfaced to the user as context ("48 min, 4.2 km, ~11 min/km"). */
  reason: string;
};

/**
 * List sessions awaiting user classification. Returns only sessions whose
 * auto bucket is "ambiguous" — sessions the auto classifier already pinned
 * as clearly_training or clearly_activity don't need the user's input.
 *
 * Window: last 14 days. Older ambiguous sessions are silently aged out so
 * the Home card and chat coach don't accumulate forever.
 */
export async function getPendingClassifications(): Promise<PendingClassification[]> {
  try {
    const session = await auth();
    if (!session?.user?.email) return [];

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return [];

    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);

    // Pull all unclassified sessions in the window + all AF workout logs
    // in the same window. The workout_logs are used to filter out sessions
    // that overlap an in-app log — those represent the SAME physical
    // activity (the user tracked it via AdaptiveFit AND it landed in HC
    // via Strava/Samsung/etc.) and don't need the user to classify them.
    const [rowsRaw, recentAfLogs] = await Promise.all([
      db
        .select({
          id: fitSessions.id,
          startTime: fitSessions.startTime,
          endTime: fitSessions.endTime,
          distanceM: fitSessions.distanceM,
          sourceApp: fitSessions.sourceApp,
        })
        .from(fitSessions)
        .where(
          and(
            eq(fitSessions.userId, user.id),
            isNull(fitSessions.userClassification),
            gte(fitSessions.endTime, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(fitSessions.startTime))
        .limit(50),
      db
        .select({
          performedAt: workoutLogs.performedAt,
          durationSec: workoutLogs.durationSec,
          distanceKm: workoutLogs.distanceKm,
          type: workoutLogs.type,
        })
        .from(workoutLogs)
        .where(
          and(
            eq(workoutLogs.userId, user.id),
            gte(workoutLogs.performedAt, fourteenDaysAgo),
          ),
        ),
    ]);

    // Dedupe overlapping sessions BEFORE classification — same activity
    // recorded by multiple HC sources (Strava + Samsung Health + Google Fit)
    // becomes one row. Otherwise the user sees "two sessions at 11:56,
    // 2.6km and 1.5km" which is the same workout twice.
    const rows = dedupeOverlappingSessions(rowsRaw);

    // Detect whether a fit_session is "covered" by an in-app AF workout —
    // i.e., the user already counted this activity by logging it in
    // AdaptiveFit, so the HC copy is a duplicate the chat coach and Home
    // card shouldn't ask about.
    //
    // Why we don't just use time-window overlap:
    //   workout_logs.performedAt is when the user LOGGED, not when they
    //   physically did the workout. If you ran at 08:00 but logged at 09:30,
    //   a naïve overlap with [performedAt, performedAt + duration] misses
    //   the 08:00 HC session entirely.
    //
    // Coverage signals (any of these → considered covered):
    //   1. Same calendar day (Asia/Jerusalem) + distances within 25% of
    //      each other — strong signal that this is the same physical run.
    //   2. Same calendar day + durations within 25% — works for strength /
    //      mobility logs where distance is null.
    //   3. Time-window overlap with 30-min tolerance (legacy path) — catches
    //      the simple case where performedAt actually was the workout time.
    function detectAfCoverage(session: {
      startTime: Date;
      endTime: Date;
      distanceM: number | null;
    }): boolean {
      const tz = "Asia/Jerusalem";
      const sessionDay = session.startTime.toLocaleDateString("en-CA", {
        timeZone: tz,
      });
      const sessionDurSec =
        (session.endTime.getTime() - session.startTime.getTime()) / 1000;
      const sessionKm =
        session.distanceM != null && session.distanceM > 0
          ? session.distanceM / 1000
          : null;
      const TOLERANCE_MS = 30 * 60 * 1000; // 30 min for the legacy window check

      for (const log of recentAfLogs) {
        const logDay = log.performedAt.toLocaleDateString("en-CA", { timeZone: tz });
        const sameDay = logDay === sessionDay;
        const logKm = log.distanceKm ? Number(log.distanceKm) : null;
        const logDurSec = log.durationSec ?? null;

        // Distance is the strongest discriminator. If BOTH have distance,
        // distance alone decides — don't fall back to duration on a
        // distance mismatch (a 60-min run and a 60-min walk have similar
        // duration but very different distance; they're different
        // activities).
        if (sessionKm != null && logKm != null && logKm > 0) {
          if (!sameDay) continue;
          const ratio = Math.abs(sessionKm - logKm) / Math.max(sessionKm, logKm);
          if (ratio < 0.25) return true;
          // Distance mismatch on same day — these are different activities.
          continue;
        }

        // No distance on one or both sides — fall back to duration matching
        // (within 25%) when both have it, then to legacy time-window overlap.
        if (
          sameDay &&
          sessionDurSec > 0 &&
          logDurSec != null &&
          logDurSec > 0
        ) {
          const ratio =
            Math.abs(sessionDurSec - logDurSec) / Math.max(sessionDurSec, logDurSec);
          if (ratio < 0.25) return true;
        }

        // Strength / mobility / other logs intrinsically lack duration.
        // A same-day match is the strongest signal we have for those —
        // the user clearly logged SOMETHING that day and the HC session
        // is most likely the same activity.
        if (
          sameDay &&
          logDurSec == null &&
          (log.type === "strength" || log.type === "mobility" || log.type === "other")
        ) {
          return true;
        }

        // Legacy time-window overlap with tolerance — only fires when we
        // didn't have a distance comparison above.
        const logStart = new Date(log.performedAt);
        const logDurAssumed = logDurSec ?? 60 * 60;
        const logEnd = new Date(logStart.getTime() + logDurAssumed * 1000);
        if (
          session.startTime.getTime() <= logEnd.getTime() + TOLERANCE_MS &&
          session.endTime.getTime() >= logStart.getTime() - TOLERANCE_MS
        ) {
          return true;
        }
      }
      return false;
    }

    // Classify + filter. Only "ambiguous" sessions that DON'T overlap an AF
    // log surface here. clearly_training and clearly_activity rows
    // auto-classify and don't need user input. AF-overlapped rows
    // implicitly are training (the user did log them) — fire the
    // auto-classify write-back below.
    const pending: PendingClassification[] = [];
    const sessionsCoveredByAfLog: string[] = [];

    for (const r of rows) {
      const durationSec = Math.max(
        0,
        Math.round((r.endTime.getTime() - r.startTime.getTime()) / 1000),
      );

      if (detectAfCoverage({
        startTime: r.startTime,
        endTime: r.endTime,
        distanceM: r.distanceM,
      })) {
        sessionsCoveredByAfLog.push(r.id);
        continue;
      }

      const cls = classifySessionSmart({
        durationSec,
        distanceM: r.distanceM,
        sourceApp: r.sourceApp,
      });
      if (cls.bucket === "ambiguous") {
        pending.push({
          id: r.id,
          startTime: r.startTime,
          endTime: r.endTime,
          distanceM: r.distanceM,
          durationSec,
          sourceApp: r.sourceApp,
          reason: cls.reason,
        });
      }
    }

    // Auto-classify the AF-covered sessions as training in the background.
    // Best-effort — never blocks the response. Once persisted, these
    // sessions won't surface again on the Home card or in the chat coach
    // prompt; they count as training in the chart (because the per-day
    // merge already prefers workout_logs, this is consistent with the
    // existing "your AF log is the source of truth on that day" rule).
    //
    // Ownership-scoped (userId + IN session IDs + still null) so we can't
    // accidentally classify someone else's sessions or overwrite a manual
    // choice the user made between query time and update time.
    if (sessionsCoveredByAfLog.length > 0) {
      void (async () => {
        try {
          await db
            .update(fitSessions)
            .set({ userClassification: "training" })
            .where(
              and(
                eq(fitSessions.userId, user.id),
                isNull(fitSessions.userClassification),
                inArray(fitSessions.id, sessionsCoveredByAfLog),
              ),
            );
          console.info(
            `[getPendingClassifications] auto-classified ${sessionsCoveredByAfLog.length} AF-overlapping session(s) as training`,
          );
        } catch (autoErr) {
          console.warn(
            "[getPendingClassifications] auto-classify AF-covered failed:",
            autoErr,
          );
        }
      })();
    }

    return pending;
  } catch (e) {
    console.error("[getPendingClassifications] error:", e);
    return [];
  }
}

export type SetClassificationResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Persist the user's classification for a specific session. Idempotent —
 * calling twice with the same value is a no-op. Calling with a different
 * value overwrites (lets the user change their mind).
 *
 * Revalidates every surface that consumes the classification so the UI
 * reflects the change immediately.
 */
export async function setSessionClassification(
  sessionId: string,
  classification: "training" | "activity",
): Promise<SetClassificationResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    // Ownership-scoped update — guards against malformed sessionId from
    // a stale client. Drizzle's update returns affected row count via
    // returning(); zero rows means the session belongs to another user
    // or doesn't exist.
    const updated = await db
      .update(fitSessions)
      .set({ userClassification: classification })
      .where(and(eq(fitSessions.id, sessionId), eq(fitSessions.userId, user.id)))
      .returning({ id: fitSessions.id });

    if (updated.length === 0) {
      return { success: false, error: "Session not found" };
    }

    revalidatePath("/home");
    revalidatePath("/analytics");
    revalidatePath("/coach");
    return { success: true };
  } catch (e) {
    console.error("[setSessionClassification] error:", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to save classification",
    };
  }
}
