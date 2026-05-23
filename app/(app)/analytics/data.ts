/**
 * analytics/data.ts
 *
 * Server-side data fetching for the Analytics page.
 * All queries run in parallel via Promise.all for performance.
 *
 * Week anchor : Sunday  (user preference)
 * Timezone    : Asia/Jerusalem
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users, fitDailyMetrics, goals, bodyMetrics, strengthLogs } from "@/lib/db/schema";
import { eq, sql, and, gte, asc } from "drizzle-orm";
import { sundayOfWeekIL, sundayNWeeksAgo, toILDateString, weekLabel } from "@/lib/analytics/week";

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
  paceMinPerKm: number | null; // decimal minutes, e.g. 6.5 = 6:30/km
  rtl: number; // Relative Training Load = km × (rpe/10)
};

export type GoalCategory = "running" | "body_shape" | "weight_loss" | "strength";

export type BodyMetricPoint = {
  date: string;       // "DD Mon"
  weightKg: number | null;
  bodyFatPct: number | null;
};

export type LiftPoint = {
  exercise: string;   // "Bench Press", "Squat", "Deadlift"
  weightKg: number;
  reps: number;
  sets: number;
  date: string;       // "DD Mon"
};

export type DailyActivityPoint = {
  day: string;        // "DD Mon" display label
  activeMin: number;  // total minutes of logged activity
  avgRpe: number;     // average RPE for that day (0 if no sessions)
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
  fitSteps7dAvg: number | null;
  // Phase 8b — Health Connect daily aggregates (7d averages). Same source as
  // fitSteps7dAvg (fit_daily_metrics). Null when no HC rows have been synced
  // yet. NOT combined with workout_logs values — HC is the source of truth
  // for daily aggregates; workout_logs covers per-workout detail only.
  fitDistance7dAvgKm: number | null;
  fitActiveMin7dAvg: number | null;
  activeGoalCategory: GoalCategory;
  activeGoalTargetValue: number | null;
  activeGoalTargetUnit: string | null;
  activeGoalTargetDate: string | null;
  activeGoalCurrentValue: number | null;
  // Phase 3 — per-category data
  bodyMetricHistory: BodyMetricPoint[];   // weight_loss + body_shape
  liftHistory: LiftPoint[];               // strength
  // A3 — daily activity (all goal categories)
  dailyActivity: DailyActivityPoint[];
};

export async function getAnalyticsData(): Promise<AnalyticsData | null> {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) return null;

  // ── Week anchors (Sunday, Asia/Jerusalem) ─────────────────────────────
  const now = new Date();
  const thisSunday = sundayOfWeekIL(now);
  // Cutoff = start of the oldest of 12 Sunday-weeks we show
  const twelveWeeksAgo = sundayNWeeksAgo(thisSunday, 11);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoDate = sevenDaysAgo.toISOString().slice(0, 10);

  // SQL fragment for Sunday-anchored week date in Israel timezone
  // EXTRACT(DOW ...) = 0 on Sunday, so subtracting it gives the preceding Sunday.
  const sundayExpr = sql`(DATE(${workoutLogs.performedAt} AT TIME ZONE 'Asia/Jerusalem') - EXTRACT(DOW FROM (${workoutLogs.performedAt} AT TIME ZONE 'Asia/Jerusalem'))::int)`;

  // A3: last 28 days for daily activity chart
  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86_400_000);

  const [weeklyRaw, sessionsRaw, coachState, fitMetrics, activeGoal, bodyMetricRows, liftRows, dailyActivityRaw] = await Promise.all([
    // ── 12-week weekly volume buckets ─────────────────────────────────────
    db
      .select({
        week: sql<string>`${sundayExpr}::text`,
        km: sql<number>`ROUND(SUM(COALESCE(${workoutLogs.distanceKm}, 0))::numeric, 2)`,
        sessions: sql<number>`COUNT(*)::int`,
      })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, twelveWeeksAgo)))
      .groupBy(sundayExpr)
      .orderBy(asc(sundayExpr)),

    // ── Last 20 sessions for trend chart ──────────────────────────────────
    db
      .select({
        performedAt: workoutLogs.performedAt,
        rpe: workoutLogs.rpe,
        footPain: workoutLogs.footPain,
        type: workoutLogs.type,
        distanceKm: workoutLogs.distanceKm,
        paceSecPerKm: workoutLogs.paceSecPerKm,
        rtl: workoutLogs.rtl,
      })
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, user.id))
      .orderBy(asc(workoutLogs.performedAt))
      .limit(20),

    // ── Coach state ───────────────────────────────────────────────────────
    db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    }),

    // ── Last 7 days of HC daily aggregates ───────────────────────────────
    // Phase 8: Health Connect writes here directly from the client. There's no
    // oauth_tokens row to gate on — presence of data IS the "connected" signal.
    // Phase 8b: also pulling distanceM and activeMinutes to surface alongside
    // steps. HC is the ground-truth source for these daily totals — we don't
    // mix with workout_logs values.
    db
      .select({
        steps: fitDailyMetrics.steps,
        distanceM: fitDailyMetrics.distanceM,
        activeMinutes: fitDailyMetrics.activeMinutes,
      })
      .from(fitDailyMetrics)
      .where(and(eq(fitDailyMetrics.userId, user.id), gte(fitDailyMetrics.date, sevenDaysAgoDate))),

    // ── Active goal (for analytics branching) ─────────────────────────────
    db.query.goals.findFirst({
      where: and(eq(goals.userId, user.id), eq(goals.status, "active")),
      orderBy: (g, { desc }) => [desc(g.createdAt)],
    }),

    // ── Body metrics — last 12 weeks (weight_loss + body_shape) ──────────
    db
      .select()
      .from(bodyMetrics)
      .where(and(eq(bodyMetrics.userId, user.id), gte(bodyMetrics.date, twelveWeeksAgo.toISOString().slice(0, 10))))
      .orderBy(asc(bodyMetrics.date))
      .limit(100),

    // ── Strength logs — last 12 weeks, one entry per exercise per workout ─
    db
      .select({
        exercise: strengthLogs.exercise,
        weightKg: strengthLogs.weightKg,
        reps: strengthLogs.reps,
        sets: strengthLogs.sets,
        performedAt: workoutLogs.performedAt,
      })
      .from(strengthLogs)
      .innerJoin(workoutLogs, eq(strengthLogs.workoutLogId, workoutLogs.id))
      .where(and(eq(strengthLogs.userId, user.id), gte(workoutLogs.performedAt, twelveWeeksAgo)))
      .orderBy(asc(workoutLogs.performedAt))
      .limit(200),

    // ── A3: Daily activity — last 28 days (activeMin + avgRpe per day) ────
    db
      .select({
        day: sql<string>`DATE(${workoutLogs.performedAt} AT TIME ZONE 'Asia/Jerusalem')::text`,
        activeMin: sql<number>`ROUND(SUM(COALESCE(${workoutLogs.durationSec}, 0)) / 60.0, 1)`,
        avgRpe: sql<number>`ROUND(AVG(${workoutLogs.rpe})::numeric, 1)`,
      })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, twentyEightDaysAgo)))
      .groupBy(sql`DATE(${workoutLogs.performedAt} AT TIME ZONE 'Asia/Jerusalem')`)
      .orderBy(asc(sql`DATE(${workoutLogs.performedAt} AT TIME ZONE 'Asia/Jerusalem')`)),
  ]);

  // Shape weekly buckets — exact Sunday-key matching, no fuzzy window
  // SQL returns "YYYY-MM-DD" strings (Sunday dates in Israel timezone)
  const weekMap = new Map<string, { km: number; sessions: number }>();
  for (const row of weeklyRaw) {
    // row.week is "YYYY-MM-DD" from Postgres ::text cast
    weekMap.set(row.week, { km: Number(row.km), sessions: Number(row.sessions) });
  }

  // Build 12 consecutive Sunday-anchored week buckets (oldest first)
  const weekly: WeeklyBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const sunday = sundayNWeeksAgo(thisSunday, i);
    const key = toILDateString(sunday); // "YYYY-MM-DD" in Israel timezone — matches SQL output
    const found = weekMap.get(key);
    weekly.push({ week: weekLabel(sunday), km: found?.km ?? 0, sessions: found?.sessions ?? 0 });
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
    paceMinPerKm: r.paceSecPerKm ? Math.round((r.paceSecPerKm / 60) * 100) / 100 : null,
    rtl: r.rtl ? parseFloat(r.rtl) : 0,
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

  // 7-day averages from Health Connect. Phase 8: HC is the ground-truth source
  // for daily aggregates; the tiles show as soon as we have any synced rows.
  // Each metric is averaged independently across the days that reported it
  // (HC writes columns sparsely — a day might have steps but no distance).
  let fitSteps7dAvg: number | null = null;
  let fitDistance7dAvgKm: number | null = null;
  let fitActiveMin7dAvg: number | null = null;
  if (fitMetrics.length > 0) {
    const stepsRows = fitMetrics.filter((m) => m.steps != null);
    if (stepsRows.length > 0) {
      fitSteps7dAvg = Math.round(
        stepsRows.reduce((s, m) => s + (m.steps ?? 0), 0) / stepsRows.length,
      );
    }
    const distRows = fitMetrics.filter((m) => m.distanceM != null);
    if (distRows.length > 0) {
      const avgM = distRows.reduce((s, m) => s + (m.distanceM ?? 0), 0) / distRows.length;
      fitDistance7dAvgKm = Math.round((avgM / 1000) * 10) / 10; // one decimal
    }
    const minRows = fitMetrics.filter((m) => m.activeMinutes != null);
    if (minRows.length > 0) {
      fitActiveMin7dAvg = Math.round(
        minRows.reduce((s, m) => s + (m.activeMinutes ?? 0), 0) / minRows.length,
      );
    }
  }

  // Shape body metrics
  const bodyMetricHistory: BodyMetricPoint[] = bodyMetricRows.map((r) => ({
    date: new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    weightKg: r.weightKg ? parseFloat(r.weightKg) : null,
    bodyFatPct: r.bodyFatPct ? parseFloat(r.bodyFatPct) : null,
  }));

  // Shape strength logs — keep only the heaviest set per exercise per session date
  const liftMap = new Map<string, LiftPoint>();
  for (const r of liftRows) {
    const key = `${r.exercise}::${new Date(r.performedAt).toISOString().slice(0, 10)}`;
    const existing = liftMap.get(key);
    const w = parseFloat(r.weightKg);
    if (!existing || w > existing.weightKg) {
      liftMap.set(key, {
        exercise: r.exercise,
        weightKg: w,
        reps: r.reps,
        sets: r.sets,
        date: new Date(r.performedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      });
    }
  }
  const liftHistory: LiftPoint[] = Array.from(liftMap.values());

  // Shape daily activity points
  const dailyActivity: DailyActivityPoint[] = dailyActivityRaw.map((r) => ({
    day: new Date(r.day + "T12:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Jerusalem",
    }),
    activeMin: Number(r.activeMin),
    avgRpe: Number(r.avgRpe),
  }));

  return {
    weekly,
    sessions,
    coachLevel: coachState?.currentLevel ?? 1,
    freezeActive: coachState?.freezeActive ?? false,
    totalKm: Math.round(totalKm * 10) / 10,
    totalSessions,
    avgRpe,
    peakWeekKm: Math.round(peakWeekKm * 10) / 10,
    fitSteps7dAvg,
    fitDistance7dAvgKm,
    fitActiveMin7dAvg,
    activeGoalCategory: (activeGoal?.category ?? "running") as GoalCategory,
    activeGoalTargetValue: activeGoal?.targetValue ? parseFloat(activeGoal.targetValue) : null,
    activeGoalTargetUnit: activeGoal?.targetUnit ?? null,
    activeGoalTargetDate: activeGoal?.targetDate ?? null,
    activeGoalCurrentValue: activeGoal?.currentValue ? parseFloat(activeGoal.currentValue) : null,
    bodyMetricHistory,
    liftHistory,
    dailyActivity,
  };
}
