import { getTranslations } from "next-intl/server";
import { getAnalyticsData } from "./data";
import { VolumeChart } from "@/components/analytics/VolumeChart";
import { TrendChart } from "@/components/analytics/TrendChart";

const LEVEL_LABELS: Record<number, string> = {
  1: "Base builder",
  2: "Easy miles",
  3: "Steady runs",
  4: "Tempo intro",
  5: "Tempo blocks",
  6: "Threshold",
  7: "Race pace",
  8: "Peak",
  9: "Sharpening",
  10: "Race-ready",
};

const LEVEL_COLORS = [
  "bg-emerald-500",
  "bg-emerald-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-teal-500",
  "bg-blue-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-violet-500",
  "bg-rose-500",
];

export default async function AnalyticsPage() {
  const t = await getTranslations("analytics");
  const data = await getAnalyticsData();

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">Sign in to see your analytics.</p>
      </div>
    );
  }

  const { weekly, sessions, coachLevel, freezeActive, totalKm, totalSessions, avgRpe, peakWeekKm } = data;
  const levelLabel = LEVEL_LABELS[coachLevel] ?? "Training";
  const levelColor = LEVEL_COLORS[(coachLevel - 1) % LEVEL_COLORS.length];
  const levelPct = Math.round((coachLevel / 10) * 100);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {/* ── Summary stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total km</p>
          <p className="mt-1 text-2xl font-bold">{totalKm}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sessions</p>
          <p className="mt-1 text-2xl font-bold">{totalSessions}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg RPE</p>
          <p className="mt-1 text-2xl font-bold">{avgRpe}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Best week</p>
          <p className="mt-1 text-2xl font-bold">{peakWeekKm} km</p>
        </div>
      </div>

      {/* ── Coach level ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("chart.coachLevel")}
          </p>
          {freezeActive && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              ❄ Freeze
            </span>
          )}
        </div>
        <div className="mt-2 flex items-end gap-3">
          <span className="text-3xl font-bold">{coachLevel}</span>
          <span className="mb-0.5 text-sm text-muted-foreground">/10 · {levelLabel}</span>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${levelColor}`}
            style={{ width: `${levelPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>Base</span>
          <span>Race-ready</span>
        </div>
      </div>

      {/* ── Weekly volume chart ───────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          Weekly km (last 8 weeks)
        </p>
        {weekly.every((w) => w.km === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <VolumeChart data={weekly} peakWeekKm={peakWeekKm} />
        )}
      </div>

      {/* ── RPE + foot pain trend ─────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          RPE & foot pain trend
        </p>
        {sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sessions yet</p>
        ) : (
          <TrendChart data={sessions} />
        )}
      </div>
    </div>
  );
}
