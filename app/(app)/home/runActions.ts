"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, runSessions, gpsPoints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { computeSplits } from "@/lib/run/haversine";
import type { GpsRawPoint } from "@/lib/run/haversine";

export type EndRunResult =
  | { success: true; runSessionId: string }
  | { success: false; error: string };

export type AppendRunPointsResult =
  | { success: true; runSessionId: string; storedPoints: number }
  | { success: false; error: string };

// ─────────────────────────────────────────────────────────────────
// appendRunPoints — called every 15s by the client while a run is live.
//
// Idempotent on clientRunId:
//   - First call inserts an in_progress run_sessions row + GPS points.
//   - Subsequent calls update distance/duration on the existing row and
//     append only points with ts > the max ts already stored.
//
// Failure of this action is non-fatal — the client keeps points in
// IndexedDB and retries on the next interval.
// ─────────────────────────────────────────────────────────────────
export async function appendRunPoints(input: {
  clientRunId: string;
  startedAt: Date;
  distanceKm: number;
  durationSec: number;
  newPoints: GpsRawPoint[];
}): Promise<AppendRunPointsResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const { clientRunId, startedAt, distanceKm, durationSec, newPoints } = input;

    // ── Upsert run_sessions row by clientRunId ───────────────────
    const existing = await db.query.runSessions.findFirst({
      where: eq(runSessions.clientRunId, clientRunId),
    });

    let runSessionId: string;
    if (existing) {
      // Safety: never let another user's clientRunId collision overwrite data.
      if (existing.userId !== user.id) {
        return { success: false, error: "Run does not belong to this user" };
      }
      // Don't downgrade a completed run back to in_progress.
      if (existing.status === "completed") {
        return { success: true, runSessionId: existing.id, storedPoints: 0 };
      }
      const avgPace = distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0;
      await db
        .update(runSessions)
        .set({
          distanceKm: distanceKm.toFixed(3),
          durationSec,
          avgPaceSecPerKm: avgPace,
          updatedAt: new Date(),
        })
        .where(eq(runSessions.id, existing.id));
      runSessionId = existing.id;
    } else {
      const avgPace = distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0;
      const [inserted] = await db
        .insert(runSessions)
        .values({
          userId: user.id,
          clientRunId,
          status: "in_progress",
          startedAt,
          endedAt: null,
          distanceKm: distanceKm.toFixed(3),
          durationSec,
          avgPaceSecPerKm: avgPace,
          splits: [],
          source: "gps",
        })
        .returning({ id: runSessions.id });
      runSessionId = inserted.id;
    }

    // ── Append only points newer than the latest stored ts ──────
    let storedPoints = 0;
    if (newPoints.length > 0) {
      const latest = await db.query.gpsPoints.findFirst({
        where: eq(gpsPoints.runSessionId, runSessionId),
        orderBy: (g, { desc }) => [desc(g.ts)],
        columns: { ts: true },
      });
      const cutoff = latest?.ts ? latest.ts.getTime() : 0;
      const fresh = newPoints.filter((p) => p.ts > cutoff);
      if (fresh.length > 0) {
        try {
          await db.insert(gpsPoints).values(
            fresh.map((p) => ({
              runSessionId,
              ts: new Date(p.ts),
              lat: p.lat,
              lon: p.lon,
              accuracyM: p.accuracy.toFixed(2),
              altitudeM: p.altitude != null ? p.altitude.toFixed(2) : null,
              heartRate: null,
              stepsDelta: null,
            })),
          );
          storedPoints = fresh.length;
        } catch (e) {
          // Non-fatal: row exists, points can be appended on the next flush.
          console.error("gpsPoints append non-fatal:", e);
        }
      }
    }

    return { success: true, runSessionId, storedPoints };
  } catch (err) {
    console.error("appendRunPoints error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ─────────────────────────────────────────────────────────────────
// endRunSession — called once when the user taps End.
//
// If a matching in_progress row exists (because the 15s sync already created
// one), this completes it in place. Otherwise it inserts a completed row
// directly (covers users with flaky/no network during the run).
// ─────────────────────────────────────────────────────────────────
export async function endRunSession(input: {
  startedAt: Date;
  endedAt: Date;
  points: GpsRawPoint[];
  distanceKm: number;
  durationSec: number;
  workoutLogId?: string;
  /** Stable client-generated UUID for idempotency. Optional for backward-compat. */
  clientRunId?: string;
}): Promise<EndRunResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const { startedAt, endedAt, points, distanceKm, durationSec, workoutLogId, clientRunId } = input;

    const avgPaceSecPerKm = distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0;
    const splits = computeSplits(points);

    // ── Try idempotent path first ───────────────────────────────
    let runSessionId: string | null = null;
    if (clientRunId) {
      const existing = await db.query.runSessions.findFirst({
        where: eq(runSessions.clientRunId, clientRunId),
      });
      if (existing) {
        if (existing.userId !== user.id) {
          return { success: false, error: "Run does not belong to this user" };
        }
        await db
          .update(runSessions)
          .set({
            status: "completed",
            endedAt,
            distanceKm: distanceKm.toFixed(3),
            durationSec,
            avgPaceSecPerKm,
            splits,
            workoutLogId: workoutLogId ?? existing.workoutLogId,
            updatedAt: new Date(),
          })
          .where(eq(runSessions.id, existing.id));
        runSessionId = existing.id;
      }
    }

    // ── Fresh insert if no partial row to upgrade ───────────────
    if (!runSessionId) {
      const [runSession] = await db
        .insert(runSessions)
        .values({
          userId: user.id,
          clientRunId: clientRunId ?? null,
          status: "completed",
          workoutLogId: workoutLogId ?? null,
          startedAt,
          endedAt,
          distanceKm: distanceKm.toFixed(3),
          durationSec,
          avgPaceSecPerKm,
          splits,
          source: "gps",
        })
        .returning({ id: runSessions.id });
      runSessionId = runSession.id;
    }

    // ── Top up gps_points with anything periodic flushes missed ──
    if (points.length > 0) {
      try {
        const latest = await db.query.gpsPoints.findFirst({
          where: eq(gpsPoints.runSessionId, runSessionId),
          orderBy: (g, { desc }) => [desc(g.ts)],
          columns: { ts: true },
        });
        const cutoff = latest?.ts ? latest.ts.getTime() : 0;
        const fresh = points.filter((p) => p.ts > cutoff);
        if (fresh.length > 0) {
          await db.insert(gpsPoints).values(
            fresh.map((p) => ({
              runSessionId: runSessionId!,
              ts: new Date(p.ts),
              lat: p.lat,
              lon: p.lon,
              accuracyM: p.accuracy.toFixed(2),
              altitudeM: p.altitude != null ? p.altitude.toFixed(2) : null,
              heartRate: null,
              stepsDelta: null,
            })),
          );
        }
      } catch (e) {
        console.error("gpsPoints final-flush non-fatal:", e);
      }
    }

    revalidatePath("/home");
    return { success: true, runSessionId };
  } catch (err) {
    console.error("endRunSession error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
