"use client";

import { useTranslations } from "next-intl";
import { Sparkles, Zap, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SessionPlan } from "@/lib/coach";

interface PreWorkoutProps {
  name: string;
  greetingKey: "greetingMorning" | "greetingAfternoon" | "greetingEvening";
  todayPlan: SessionPlan | null;
  loggedToday: boolean;
  aiSummary: string | null;
  onLogManual: () => void;
}

function formatRunBlockPace(paceSecPerKm: number): string {
  const minutes = Math.floor(paceSecPerKm / 60);
  const seconds = Math.floor(paceSecPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

export default function PreWorkout({
  name,
  greetingKey,
  todayPlan,
  loggedToday,
  aiSummary,
  onLogManual,
}: PreWorkoutProps) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t(`home.${greetingKey}`, { name })}
        </h1>
        {todayPlan && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{todayPlan.title}</p>
        )}
      </div>

      {/* Coach Insight Card */}
      {todayPlan && (
        <div className="rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 p-5 text-white shadow-lg">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-sm leading-relaxed">{todayPlan.rationale}</p>
          </div>
        </div>
      )}

      {/* Workout Steps Timeline */}
      {todayPlan && todayPlan.blocks.length > 0 && (
        <div className="space-y-3">
          {todayPlan.blocks.map((block, idx) => {
            let title = "";
            let description = "";

            if (block.kind === "warmup") {
              title = t("home.warmup");
              description = `${block.durationMin} min`;
            } else if (block.kind === "run_block") {
              title = "Run Block";
              description = `${block.reps} × ${block.distanceKm}km @ ${formatRunBlockPace(block.paceSecPerKm)}`;
            } else if (block.kind === "mobility") {
              title = t("home.mobility");
              description = block.exercises.join(" · ");
            } else if (block.kind === "rest") {
              title = t("home.rest");
              description = "Recovery day";
            }

            return (
              <div key={idx} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300">
                    {idx + 1}
                  </div>
                  {idx < todayPlan.blocks.length - 1 && (
                    <div className="mt-2 h-8 w-0.5 bg-slate-200 dark:bg-slate-700" />
                  )}
                </div>
                <div className="flex-1 pt-1 pb-4">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Grid */}
      {!loggedToday ? (
        <div className="grid grid-cols-2 gap-3">
          {/* Start Run Button - Disabled */}
          <button
            disabled
            title={t("home.startRunSoon")}
            className="group relative flex flex-col items-center justify-center gap-2 rounded-3xl bg-blue-600 p-5 text-white shadow-lg shadow-blue-600/20 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap className="h-6 w-6" />
            <span className="text-sm font-semibold">{t("home.startRun")}</span>
            <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
              {t("home.startRunSoon")}
            </div>
          </button>

          {/* Log Manual Button */}
          <button
            onClick={onLogManual}
            className="flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            <ClipboardList className="h-6 w-6 text-slate-700 dark:text-slate-300" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("home.logManual")}
            </span>
          </button>
        </div>
      ) : (
        <div className="rounded-full bg-emerald-100 px-4 py-2 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          ✓ {t("home.alreadyLogged")}
        </div>
      )}

      {/* AI Summary for logged-today case */}
      {loggedToday && aiSummary && (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          {aiSummary}
        </div>
      )}
    </div>
  );
}
