import { getTranslations } from "next-intl/server";
import { getAnalyticsData } from "./data";
import { TrendChartCard } from "@/components/analytics/TrendChartCard";
import { WeightTrendChart } from "@/components/analytics/WeightTrendChart";
import { LiftProgressChart } from "@/components/analytics/LiftProgressChart";
import { DailyActivityChart } from "@/components/analytics/DailyActivityChart";
import { TrendingUp, TrendingDown, Minus, Footprints, Scale, Dumbbell } from "lucide-react";

function TrendChip({ value, ideal }: { value: string; ideal?: boolean }) {
  if (ideal) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Minus className="h-3 w-3" />
        Ideal
      </span>
    );
  }
  const isUp = value.startsWith("+");
  const isDown = value.startsWith("−") || value.startsWith("-");
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        isUp
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : isDown
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {isUp ? <TrendingUp className="h-3 w-3" /> : isDown ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {value}
    </span>
  );
}


export default async function AnalyticsPage() {
  const t = await getTranslations("analytics");
  const data = await getAnalyticsData();

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">Sign in to see your analytics.</p>
      </div>
    );
  }

  // coachLevel + freezeActive intentionally NOT destructured — the Coach
  // Level card moved entirely to the Home screen (Phase-7 cleanup).
  const {
    sessions, weekly, avgRpe,
    fitSteps7dAvg, fitDistance7dAvgKm, fitActiveMin7dAvg,
    activeGoalCategory, activeGoalTargetValue, activeGoalTargetUnit,
    bodyMetricHistory, liftHistory, dailyActivity,
  } = data;

  // Phase 8b — Show the Health Connect card iff at least one HC metric has
  // been synced. HC is the source of truth for these daily aggregates; we do
  // NOT combine with workout_logs values (workout_logs covers per-workout
  // detail like RPE/pace/foot-pain, not daily totals).
  const showHealthConnect =
    fitSteps7dAvg != null ||
    fitDistance7dAvgKm != null ||
    fitActiveMin7dAvg != null;

  // Stat tile calculations
  const currentWeekKm = weekly[weekly.length - 1]?.km ?? 0;
  const prevWeekKm = weekly[weekly.length - 2]?.km ?? 0;
  const weeklyTrend =
    prevWeekKm === 0
      ? null
      : currentWeekKm >= prevWeekKm * 0.8 && currentWeekKm <= prevWeekKm * 1.2
        ? null
        : currentWeekKm > prevWeekKm
          ? `+${Math.round(((currentWeekKm - prevWeekKm) / prevWeekKm) * 100)}%`
          : `−${Math.round(((prevWeekKm - currentWeekKm) / prevWeekKm) * 100)}%`;

  const rpeIdeal = avgRpe >= 4 && avgRpe <= 7;

  // Determine which goal-specific charts to surface in the bottom section.
  const showLifts = activeGoalCategory === "strength" && liftHistory.length > 0;
  const showBodyComposition =
    activeGoalCategory === "body_shape" &&
    bodyMetricHistory.filter((d) => d.bodyFatPct != null).length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ── 1. Stat tiles: Weekly distance + Avg RPE (same location) ─ */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("weeklyDistance")}
          </p>
          <p className="mt-1 text-2xl font-bold">{currentWeekKm.toFixed(1)} km</p>
          <div className="mt-2">
            {weeklyTrend ? <TrendChip value={weeklyTrend} /> : <TrendChip value="" ideal />}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("avgRpe")}
          </p>
          <p className="mt-1 text-2xl font-bold">{avgRpe > 0 ? avgRpe.toFixed(1) : "—"}</p>
          <div className="mt-2">
            {avgRpe > 0 ? <TrendChip value="" ideal={rpeIdeal} /> : null}
          </div>
        </div>

        {/* Health Connect daily aggregates (Phase 8b). One card with up to
            three metrics — steps, distance, active minutes — averaged across
            the last 7 days. Each cell renders independently so a missing
            metric (e.g. distance but no active minutes) doesn't blank the
            card. HC is the source of truth here, separate from the
            workout-derived stats above. */}
        {showHealthConnect && (
          <div className="col-span-2 rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-indigo-500" />
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Health Connect — 7d average
              </p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Steps</p>
                <p className="mt-0.5 text-lg font-bold">
                  {fitSteps7dAvg != null ? fitSteps7dAvg.toLocaleString() : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Distance</p>
                <p className="mt-0.5 text-lg font-bold">
                  {fitDistance7dAvgKm != null ? `${fitDistance7dAvgKm.toFixed(1)} km` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</p>
                <p className="mt-0.5 text-lg font-bold">
                  {fitActiveMin7dAvg != null ? `${fitActiveMin7dAvg} min` : "—"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">From Health Connect</p>
          </div>
        )}
      </div>

      {/* ── 2. Daily Activity ───────────────────────────────────────── */}
      <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
        <p className="mb-1 text-sm font-semibold">Daily Activity</p>
        <p className="mb-4 text-[11px] text-muted-foreground">
          <span className="inline-block h-2 w-4 rounded-full bg-indigo-500 align-middle opacity-75" /> Active time &nbsp;
          <span className="inline-block h-2 w-4 rounded-full bg-orange-500 align-middle" /> Avg RPE
        </p>
        {dailyActivity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Log workouts to see your daily activity trend.
          </p>
        ) : (
          <DailyActivityChart data={dailyActivity} />
        )}
      </div>

      {/* Weekly Cardio Sessions removed (Phase-7 cleanup): the same info is
          encoded more usefully in the Daily Activity chart above (effort per
          day) and the Weekly Distance tile (km, which the user cares about
          more than session count). VolumeChart left in components/ in case
          we want a 12-week distance bar chart back later. */}

      {/* ── Distance × Pace toggle (TrendChartCard) ────────────────── */}
      <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
        <p className="mb-3 text-sm font-semibold">{t("chart.rpePace")}</p>
        {sessions.filter((s) => s.paceMinPerKm != null).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Log a run to see pace trends.
          </p>
        ) : (
          <TrendChartCard data={sessions} />
        )}
      </div>

      {/* ── Weight trend (with optional body-fat overlay) ──────────── */}
      {/* Phase-7 cleanup: the separate "Body Composition" card was just this
          chart re-rendered, so it's gone. When the active goal is body_shape
          AND there's at least one body-fat reading, this card now shows both
          lines on a dual axis. */}
      <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
        <div className="flex items-center gap-2 mb-3">
          <Scale className="h-4 w-4 text-indigo-500" />
          <p className="text-sm font-semibold">
            {showBodyComposition ? "Weight & Body Fat" : "Weight Trend"}
          </p>
        </div>
        {bodyMetricHistory.filter((d) => d.weightKg != null).length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No weight entries yet. Log your weight in Settings to start tracking.
          </p>
        ) : (
          <WeightTrendChart
            data={bodyMetricHistory}
            targetWeightKg={
              activeGoalTargetUnit === "kg" ? activeGoalTargetValue : null
            }
            showBodyFat={showBodyComposition}
          />
        )}
      </div>

      {/* Coach Level removed (Phase-7 cleanup) — already shown on the Home
          screen as the primary level surface; second copy here added clutter
          without new information. Freeze state is also shown on Home. */}

      {/* ── Goal-specific insights (only when relevant data exists) ─── */}
      {showLifts && (
        <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3">
            <Dumbbell className="h-4 w-4 text-indigo-500" />
            <p className="text-sm font-semibold">Lift Progression (kg)</p>
          </div>
          <LiftProgressChart data={liftHistory} />
        </div>
      )}
    </div>
  );
}
