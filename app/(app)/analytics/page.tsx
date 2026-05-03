import { getTranslations } from "next-intl/server";
import { getAnalyticsData } from "./data";
import { VolumeChart } from "@/components/analytics/VolumeChart";
import { TrendChart } from "@/components/analytics/TrendChart";
import { TrendingUp, TrendingDown, Minus, Footprints, Scale, Activity, Dumbbell } from "lucide-react";
import type { GoalCategory } from "./data";

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

function GoalPlaceholderCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900 flex items-start gap-4">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
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

  const { sessions, weekly, coachLevel, freezeActive, avgRpe, fitSteps7dAvg, activeGoalCategory } = data;

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
          {/* RPE vs Pace dual-axis chart */}
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">{t("chart.rpePace")}</p>
            <p className="mb-4 text-[11px] text-muted-foreground">
              <span className="inline-block h-2 w-4 rounded-full bg-blue-600 align-middle" /> RPE &nbsp;
              <span className="inline-block h-2 w-4 rounded-full bg-red-600 align-middle" /> Pace
            </p>
            {sessions.filter((s) => s.type === "run").length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noRuns")}</p>
            ) : (
              <TrendChart data={sessions} />
            )}
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
          <GoalPlaceholderCard
            icon={<Scale className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
            title="Weight Progress"
            description="Log your weight weekly in Settings → Goal to track your progress here. Chart coming soon."
          />
          {/* Still show weekly sessions volume */}
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Workout Volume</p>
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
          <GoalPlaceholderCard
            icon={<Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
            title="Body Composition Tracking"
            description="Body fat % and training mix charts are coming soon. Keep logging your workouts to build your trend."
          />
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Workout Volume</p>
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
          <GoalPlaceholderCard
            icon={<Dumbbell className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
            title="Strength Progress"
            description="Lift PR tracking (bench, squat, deadlift) is coming soon. Log your sessions to build history."
          />
          <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <p className="mb-1 text-sm font-semibold">Weekly Workout Volume</p>
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
