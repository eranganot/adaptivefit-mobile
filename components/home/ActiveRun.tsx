"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, Square, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import BatterySaverModal from "@/components/run/BatterySaverModal";
import { useRunTracker } from "@/lib/run/tracker";
import type { GpsRawPoint } from "@/lib/run/haversine";

// Lazy-load Mapbox so it doesn't bloat the initial bundle
const MapboxLiveMap = dynamic(() => import("@/components/run/MapboxLiveMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800">
      <MapPin className="h-6 w-6 animate-pulse text-slate-400" />
    </div>
  ),
});

interface ActiveRunProps {
  sessionTitle: string;    // e.g. "Step 2 of 3 — Easy Pace Run"
  onEnd: (data: {
    startedAt: Date;
    endedAt: Date;
    points: GpsRawPoint[];
    distanceKm: number;
    durationSec: number;
  }) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatPace(secPerKm: number | null): string {
  if (!secPerKm) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ActiveRun({ sessionTitle, onEnd }: ActiveRunProps) {
  const t = useTranslations("run");
  const tracker = useRunTracker();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startedRef = useRef(false);

  // ── Auto-start on mount ───────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    tracker.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wake lock ─────────────────────────────────────────────────
  useEffect(() => {
    if (tracker.status === "running" && !wakeLockRef.current) {
      navigator.wakeLock
        ?.request("screen")
        .then((lock) => { wakeLockRef.current = lock; })
        .catch(() => { /* not supported or denied — handled gracefully */ });
    }
    if (tracker.status === "paused" || tracker.status === "ended") {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, [tracker.status]);

  const handleEnd = () => {
    const data = tracker.end();
    if (data) onEnd(data);
  };

  const metrics = [
    {
      label: t("avgPace"),
      value: formatPace(tracker.paceSecPerKm),
      unit: "/km",
      color: "text-blue-600",
    },
    {
      label: t("heartRate"),
      value: "—",
      unit: "bpm",
      color: "text-rose-500",
    },
    {
      label: t("distance"),
      value: tracker.distanceKm.toFixed(2),
      unit: "km",
      color: "text-emerald-600",
    },
    {
      label: t("steps"),
      value: "—",
      unit: "",
      color: "text-amber-500",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Phase header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("activeRun")}
          </p>
          <h1 className="text-lg font-bold tracking-tight">{sessionTitle}</h1>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            tracker.status === "paused"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          }`}
        >
          {tracker.status === "paused" ? t("paused") : t("running")}
        </span>
      </div>

      {/* Live map */}
      <MapboxLiveMap
        route={tracker.route}
        currentPosition={tracker.currentPosition}
        isRunning={tracker.status === "running"}
        className="h-48 w-full"
      />

      {/* Big timer */}
      <div className="flex flex-col items-center py-2">
        <span
          className={`font-black tabular-nums text-6xl tracking-tight transition-colors ${
            tracker.status === "paused" ? "text-slate-400" : "text-slate-900 dark:text-slate-50"
          }`}
          style={{
            textShadow:
              tracker.status === "running"
                ? "0 0 32px rgba(37,99,235,0.25)"
                : "none",
          }}
        >
          {formatTime(tracker.secondsElapsed)}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t("elapsed")}</p>
      </div>

      {/* 4-tile metric grid */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {m.label}
            </p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${m.color}`}>
              {m.value}
              {m.unit && (
                <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                  {m.unit}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {tracker.error && (
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
          {tracker.error}
        </div>
      )}

      {/* Battery-saver modal — shown once if wakeLock unavailable */}
      <BatterySaverModal />

      {/* Controls */}
      <div className="flex gap-3">
        <button
          onClick={tracker.status === "paused" ? tracker.resume : tracker.pause}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {tracker.status === "paused" ? (
            <><Play className="h-5 w-5" /> {t("resume")}</>
          ) : (
            <><Pause className="h-5 w-5" /> {t("pause")}</>
          )}
        </button>
        <button
          onClick={handleEnd}
          className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-rose-600 py-4 font-semibold text-white shadow-lg shadow-rose-600/20 transition-colors hover:bg-rose-700"
        >
          <Square className="h-5 w-5 fill-white" />
          {t("endRun")}
        </button>
      </div>
    </div>
  );
}
