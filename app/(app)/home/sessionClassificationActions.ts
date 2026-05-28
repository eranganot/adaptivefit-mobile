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
import { users, fitSessions } from "@/lib/db/schema";
import { eq, and, isNull, desc, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { classifySessionSmart } from "@/lib/coach/externalActivity";

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

    const rows = await db
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
      .limit(20);

    // Filter to only "ambiguous" per the auto classifier. clearly_training
    // and clearly_activity rows are unclassified-but-not-pending —
    // they don't need user input. Done in JS rather than SQL because the
    // classifier is multi-rule and shouldn't be duplicated in Postgres.
    const pending: PendingClassification[] = [];
    for (const r of rows) {
      const durationSec = Math.max(
        0,
        Math.round((r.endTime.getTime() - r.startTime.getTime()) / 1000),
      );
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
