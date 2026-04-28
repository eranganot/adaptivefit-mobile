/**
 * analytics/data.ts
 *
 * Server-side data fetching for the Analytics page.
 * All queries run in parallel via Promise.all for performance.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users } from "@/lib/db/schema";
import { eq, sql, and, gte, asc } from "drizzle-orm";

export type WeeklyBucket = {
  week: string; // "DD Mon" label
  km: number;
  sessions: number;
};

export type SessionPoint = {
  label: string; // "DD Mon"
  rpe: number;
  footPain: number;
  type: string;
  km: number | null;
};

export type AnalyticsData = {
  weekly: WeeklyBucket[];
  sessions: SessionPoint[];
  coachLevel: number;
  freezeActive: boolean;
  totalKm: number;
  totalSessions: number;
  avgRpe: number;
  peakWeekKm: number;
};

function fmtWeekLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function getAnalyticsData(): Promise<AnalyticsData | null> {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) return null;

  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

  const [weeklyRaw, sessionsRaw, coachState] = await Promise.all([
    // ── 12-week weekly volume buckets (typed Drizzle select) ───────────────
    db
      .select({
        week: sql<string>`DATE_TRUNC('week', ${workoutLogs.performedAt} AT TIME ZONE 'UTC')`,
        km: sql<number>`ROUND(SUM(COALESCE(${workoutLogs.distanceKm}, 0))::numeric, 2)`,
        sessions: sql<number>`COUNT(*)::int`,
      })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, twelveWeeksAgo)))
      .groupBy(
        sql`DATE_TRUNC('week', ${workoutLogs.performedAt} AT TIME ZONE 'UTC')`,
      )
      .orderBy(
        asc(sql`DATE_TRUNC('week', ${workoutLogs.performedAt} AT TIME ZONE 'UTC')`),
      ),

    // ── Last 20 sessions for trend chart ──────────────────────────────────
    db
      .select({
        performedAt: workoutLogs.performedAt,
        rpe: workoutLogs.rpe,
        footPain: workoutLogs.footPain,
        type: workoutLogs.type,
        distanceKm: workoutLogs.distanceKm,
      })
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, user.id))
      .orderBy(asc(workoutLogs.performedAt))
      .limit(20),

    // ── Coach state ───────────────────────────────────────────────────────
    db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    }),
  ]);

  // Shape weekly buckets — fill missing weeks with 0
  const weekMap = new Map<string, { km: number; sessions: number }>();
  for (const row of weeklyRaw) {
    const d = new Date(row.week);
    weekMap.set(d.toISOString(), { km: Number(row.km), sessions: Number(row.sessions) });
  }

  // Build 12 consecutive week buckets
  const weekly: WeeklyBucket[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay() - i * 7); // Monday of that week
    d.setHours(0, 0, 0, 0);
    let found: { km: number; sessions: number } | undefined;
    for (const [isoKey, v] of weekMap) {
      const wd = new Date(isoKey);
      if (Math.abs(wd.getTime() - d.getTime()) < 1000 * 60 * 60 * 24 * 2) {
        found = v;
        break;
      }
    }
    weekly.push({ week: fmtWeekLabel(d), km: found?.km ?? 0, sessions: found?.sessions ?? 0 });
  }

  // Shape session points
  const sessions: SessionPoint[] = sessionsRaw.map((r) => ({
    label: new Date(r.performedAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
    rpe: r.rpe,
    footPain: r.footPain,
    type: r.type,
    km: r.distanceKm ? parseFloat(r.distanceKm) : null,
  }));

  // Summary stats
  const totalKm = sessionsRaw.reduce(
    (s, r) => s + (r.distanceKm ? parseFloat(r.distanceKm) : 0),
    0,
  );
  const totalSessions = sessionsRaw.length;
  const avgRpe =
    totalSessions > 0
      ? Math.round((sessionsRaw.reduce((s, r) => s + r.rpe, 0) / totalSessions) * 10) / 10
      : 0;
  const peakWeekKm = weekly.reduce((m, w) => Math.max(m, w.km), 0);

  return {
    weekly,
    sessions,
    coachLevel: coachState?.currentLevel ?? 1,
    freezeActive: coachState?.freezeActive ?? false,
    totalKm: Math.round(totalKm * 10) / 10,
    totalSessions,
    avgRpe,
    peakWeekKm: Math.round(peakWeekKm * 10) / 10,
  };
}
