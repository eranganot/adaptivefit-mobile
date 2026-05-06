import { getTranslations } from "next-intl/server";
import { getAnalyticsData } from "./data";
import { VolumeChart } from "@/components/analytics/VolumeChart";
import { TrendChartCard } from "@/components/analytics/TrendChartCard";
import { WeightTrendChart } from "@/components/analytics/WeightTrendChart";
import { LiftProgressChart } from "@/components/analytics/LiftProgressChart";
import { TrendingUp, TrendingDown, Minus, Footprints, Scale, Activity, Dumbbell } from "lucide-react";

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

  const {
    sessions, weekly, coachLevel, freezeActive, avgRpe, fitSteps7dAvg,
    activeGoalCategory, activeGoalTargetValue, activeGoalTargetUnit,
    bodyMetricHistory, liftHistory,
  } = data;

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ── Stat tiles ─────────────────────────────────────────────── */}
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

        {/* Steps tile — only shown when Google Fit is connected */}
        {fitSteps7dAvg != null && (
          <div className="col-span-2 rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-indigo-500" />
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Daily Steps (7d avg)
              </p>
            </div>
            <p className="mt-1 text-2xl font-bold">{fitSteps7dAvg.toLocaleString()}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">From Google Fit</p>
          </div>
        )}
      </div>

      {/* ── Goal-specific analytics ────────────────────────────────── */}
      {activeGoalCategory === "running" && (
        <>
          {/* RPE / Distance vs Pace chart with toggle */}
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-3 text-sm font-semibold">{t("chart.rpePace")}</p>
            <TrendChartCard data={sessions} />
          </div>

          {/* Weekly distance bar chart */}
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">{t("chart.weeklyVol")}</p>
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noSessions")}</p>
            ) : (
              <VolumeChart data={weekly} />
            )}
          </div>
        </>
      )}

      {activeGoalCategory === "weight_loss" && (
        <>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-3">
              <Scale className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-semibold">Weight Trend</p>
            </div>
            {bodyMetricHistory.filter((d) => d.weightKg != null).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No weight entries yet. Log your weight in Settings → Goal to start tracking.
              </p>
            ) : (
              <WeightTrendChart
                data={bodyMetricHistory}
                targetWeightKg={activeGoalTargetUnit === "kg" ? activeGoalTargetValue : null}
              />
            )}
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Cardio Sessions</p>
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noSessions")}</p>
            ) : (
              <VolumeChart data={weekly} />
            )}
          </div>
        </>
      )}

      {activeGoalCategory === "body_shape" && (
        <>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-semibold">Body Composition</p>
            </div>
            {bodyMetricHistory.filter((d) => d.bodyFatPct != null || d.weightKg != null).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No body metrics yet. Log weight & body fat in Settings → Goal to track progress.
              </p>
            ) : (
              <WeightTrendChart data={bodyMetricHistory} targetWeightKg={null} />
            )}
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Training Volume</p>
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noSessions")}</p>
            ) : (
              <VolumeChart data={weekly} />
            )}
          </div>
        </>
      )}

      {activeGoalCategory === "strength" && (
        <>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-semibold">Lift Progression (kg)</p>
            </div>
            {liftHistory.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No strength sessions logged yet. Log a strength workout to start tracking your lifts.
              </p>
            ) : (
              <LiftProgressChart data={liftHistory} />
            )}
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Session Volume</p>
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noSessions")}</p>
            ) : (
              <VolumeChart data={weekly} />
            )}
          </div>
        </>
      )}

      {/* ── Coach level ────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("chart.coachLevel")}
          </p>
          {freezeActive && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              ❄ Freeze
            </span>
          )}
        </div>
        <div className="mt-2 flex items-end gap-3">
          <span className="text-3xl font-bold">{coachLevel}</span>
          <span className="mb-0.5 text-sm text-muted-foreground">/10</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${Math.round((coachLevel / 10) * 100)}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Base builder</span>
          <span>Race-ready</span>
        </div>
      </div>
    </div>
  );
}
