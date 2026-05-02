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

export async function endRunSession(input: {
  startedAt: Date;
  endedAt: Date;
  points: GpsRawPoint[];
  distanceKm: number;
  durationSec: number;
  workoutLogId?: string;
}): Promise<EndRunResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const { startedAt, endedAt, points, distanceKm, durationSec, workoutLogId } = input;

    // Compute avg pace + splits
    const avgPaceSecPerKm =
      distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0;
    const splits = computeSplits(points);

    // Insert run_sessions row
    const [runSession] = await db
      .insert(runSessions)
      .values({
        userId: user.id,
        workoutLogId: workoutLogId ?? null,
        startedAt,
        endedAt,
        distanceKm: distanceKm.toFixed(3),
        durationSec,
        avgPaceSecPerKm,
        splits,
        source: "gps",
      })
      .returning();

    // Bulk-insert GPS points (non-fatal if fails — run summary still usable)
    if (points.length > 0) {
      try {
        await db.insert(gpsPoints).values(
          points.map((p) => ({
            runSessionId: runSession.id,
            ts: new Date(p.ts),
            lat: p.lat,
            lon: p.lon,
            accuracyM: p.accuracy.toFixed(2),
            altitudeM: p.altitude != null ? p.altitude.toFixed(2) : null,
            heartRate: null,
            stepsDelta: null,
          })),
        );
      } catch (e) {
        console.error("gpsPoints insert non-fatal:", e);
      }
    }

    revalidatePath("/home");
    return { success: true, runSessionId: runSession.id };
  } catch (err) {
    console.error("endRunSession error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
