/**
 * analytics/data.ts
 *
 * Server-side data fetching for the Analytics page.
 * All queries run in parallel via Promise.all for performance.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export type WeeklyBucket = {
  week: string; // "Mon DD" label
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

  const [weeklyRaw, sessionsRaw, coachState] = await Promise.all([
    // ── 12-week weekly volume buckets ──────────────────────────────────────
    db.execute(sql`
      SELECT
        DATE_TRUNC('week', performed_at AT TIME ZONE 'UTC') AS week,
        ROUND(SUM(COALESCE(distance_km, 0))::numeric, 2)    AS km,
        COUNT(*)::int                                        AS sessions
      FROM workout_logs
      WHERE user_id = ${user.id}
        AND performed_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY 1
      ORDER BY 1
    `),

    // ── Last 20 sessions for trend chart ──────────────────────────────────
    db.execute(sql`
      SELECT
        performed_at,
        rpe,
        foot_pain,
        type,
        distance_km
      FROM workout_logs
      WHERE user_id = ${user.id}
      ORDER BY performed_at
      LIMIT 20
    `),

    // ── Coach state ───────────────────────────────────────────────────────
    db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    }),
  ]);

  // Shape weekly buckets — fill missing weeks with 0
  const weekMap = new Map<string, { km: number; sessions: number }>();
  for (const row of weeklyRaw.rows as any[]) {
    const d = new Date(row.week);
    weekMap.set(d.toISOString(), { km: parseFloat(row.km), sessions: row.sessions });
  }

  // Build 12 consecutive week buckets
  const weekly: WeeklyBucket[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay() - i * 7); // Monday of that week
    d.setHours(0, 0, 0, 0);
    // Find matching bucket (match on Monday of week)
    let found: { km: number; sessions: number } | undefined;
    for (const [isoKey, v] of weekMap) {
      const wd = new Date(isoKey);
      if (Math.abs(wd.getTime() - d.getTime()) < 1000 * 60 * 60 * 24 * 2) {
        found = v;
        break;
      }
    }
    weekly.push({
      week: fmtWeekLabel(d),
      km: found?.km ?? 0,
      sessions: found?.sessions ?? 0,
    });
  }

  // Shape session points
  const sessions: SessionPoint[] = (sessionsRaw.rows as any[]).map((r) => ({
    label: new Date(r.performed_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
    rpe: r.rpe,
    footPain: r.foot_pain,
    type: r.type,
    km: r.distance_km ? parseFloat(r.distance_km) : null,
  }));

  // Summary stats
  const allRows = sessionsRaw.rows as any[];
  const totalKm = allRows.reduce((s, r) => s + (r.distance_km ? parseFloat(r.distance_km) : 0), 0);
  const totalSessions = allRows.length;
  const avgRpe = totalSessions > 0
    ? Math.round((allRows.reduce((s, r) => s + r.rpe, 0) / totalSessions) * 10) / 10
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
