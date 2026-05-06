"use client";

import { useState, useEffect } from "react";
import { TrendChart } from "./TrendChart";
import type { TrendMode } from "./TrendChart";
import type { SessionPoint } from "@/app/(app)/analytics/data";

const STORAGE_KEY = "analytics_trend_mode";

interface Props {
  data: SessionPoint[];
}

export function TrendChartCard({ data }: Props) {
  const [mode, setMode] = useState<TrendMode>("rpe");

  // Restore persisted preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "rpe" || stored === "distance") setMode(stored);
    } catch {
      // localStorage unavailable (e.g. SSR safety)
    }
  }, []);

  const handleToggle = (next: TrendMode) => {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const hasRunData = data.some((s) => s.type === "run");

  return (
    <div>
      {/* Legend + toggle row */}
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-muted-foreground">
          {mode === "rpe" ? (
            <>
              <span className="inline-block h-2 w-4 rounded-full bg-blue-600 align-middle" /> RPE &nbsp;
              <span className="inline-block h-2 w-4 rounded-full bg-red-600 align-middle" /> Pace
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-4 rounded-full bg-indigo-500 align-middle" /> Distance &nbsp;
              <span className="inline-block h-2 w-4 rounded-full bg-red-600 align-middle" /> Pace
            </>
          )}
        </p>

        {/* Toggle pill */}
        <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-0.5 text-[10px] font-semibold">
          <button
            onClick={() => handleToggle("rpe")}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "rpe"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            RPE × Pace
          </button>
          <button
            onClick={() => handleToggle("distance")}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "distance"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            Dist × Pace
          </button>
        </div>
      </div>

      {!hasRunData ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No run sessions logged yet.</p>
      ) : (
        <TrendChart data={data} mode={mode} />
      )}
    </div>
  );
}
