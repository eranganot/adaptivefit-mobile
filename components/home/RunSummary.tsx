"use client";

import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { computeSplits } from "@/lib/run/haversine";
import type { GpsRawPoint } from "@/lib/run/haversine";
import dynamic from "next/dynamic";

const MapboxLiveMap = dynamic(() => import("@/components/run/MapboxLiveMap"), {
  ssr: false,
  loading: () => <div className="h-40 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse" />,
});

interface RunSummaryProps {
  distanceKm: number;
  durationSec: number;
  points: GpsRawPoint[];
  onGetFeedback: (rpeEstimate: number) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${rem}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export default function RunSummary({
  distanceKm,
  durationSec,
  points,
  onGetFeedback,
}: RunSummaryProps) {
  const t = useTranslations("run");

  const avgPaceSec = distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0;
  const splits = computeSplits(points);

  // Detect degraded GPS capture so we can warn the user instead of showing all-zero stats.
  const noGpsData = points.length === 0 && distanceKm === 0 && durationSec === 0;

  // Fastest split for relative bar widths
  const fastestSplit = splits.length > 0
    ? Math.min(...splits.map((s) => s.paceSec))
    : 0;

  const stats = [
    { label: t("totalDistance"), value: `${distanceKm.toFixed(2)} km` },
    { label: t("totalTime"), value: formatDuration(durationSec) },
    { label: "Avg Pace", value: avgPaceSec > 0 ? formatPace(avgPaceSec) : "—" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("summary")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Degraded GPS warning */}
      {noGpsData && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          No GPS data was captured for this run. You can still log it manually below — just enter how it felt.
        </div>
      )}

      {/* Route snapshot */}
      <MapboxLiveMap
        route={points}
        currentPosition={points.length > 0 ? { lat: points[points.length - 1].lat, lon: points[points.length - 1].lon } : null}
        isRunning={false}
        className="h-40 w-full"
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-3xl bg-white shadow-sm dark:divide-slate-800 dark:bg-slate-900">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col items-center py-4">
            <span className="text-lg font-bold tabular-nums">{s.value}</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Pace splits */}
      {splits.length > 0 && (
        <div className="rounded-3xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <p className="mb-3 text-sm font-semibold">Pace Splits</p>
          <div className="space-y-2">
            {splits.map((split) => {
              const barWidth = fastestSplit > 0
                ? Math.round((fastestSplit / split.paceSec) * 100)
                : 50;
              return (
                <div key={split.km} className="flex items-center gap-3">
                  <span className="w-10 text-right text-xs font-medium text-muted-foreground">
                    {t("splitKm", { n: split.km })}
                  </span>
                  <div className="flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="w-16 text-xs tabular-nums text-slate-700 dark:text-slate-300">
                    {formatPace(split.paceSec)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Get Feedback CTA */}
      <button
        onClick={() => onGetFeedback(5)} // Default Moderate RPE estimate
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700"
      >
        <MessageSquare className="h-5 w-5" />
        {t("getFeedback")}
      </button>
    </div>
  );
}
