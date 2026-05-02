"use client";

import { useTranslations } from "next-intl";
import { Sparkles, Zap, ClipboardList, Footprints, Timer } from "lucide-react";
import type { SessionPlan } from "@/lib/coach";

interface PreWorkoutProps {
  name: string;
  greetingKey: "greetingMorning" | "greetingAfternoon" | "greetingEvening";
  todayPlan: SessionPlan | null;
  loggedToday: boolean;
  aiSummary: string | null;
  onLogManual: () => void;
  onStartRun: () => void;
  fitYesterday: { steps: number | null; activeMinutes: number | null } | null;
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
  onStartRun,
  fitYesterday,
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

      {/* Yesterday's Fit stats strip — shown only when Google Fit is connected */}
      {fitYesterday && (fitYesterday.steps || fitYesterday.activeMinutes) && (
        <div className="flex items-center gap-4 rounded-2xl bg-slate-100 px-4 py-2.5 dark:bg-slate-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Yesterday
          </p>
          {fitYesterday.steps != null && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Footprints className="h-3.5 w-3.5 text-indigo-500" />
              {fitYesterday.steps.toLocaleString()} steps
            </div>
          )}
          {fitYesterday.activeMinutes != null && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Timer className="h-3.5 w-3.5 text-emerald-500" />
              {fitYesterday.activeMinutes} active min
            </div>
          )}
        </div>
      )}

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
          <button
            onClick={onStartRun}
            className="group flex flex-col items-center justify-center gap-2 rounded-3xl bg-blue-600 p-5 text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 active:scale-95"
          >
            <Zap className="h-6 w-6" />
            <span className="text-sm font-semibold">{t("home.startRun")}</span>
          </button>

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

      {loggedToday && aiSummary && (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          {aiSummary}
        </div>
      )}
    </div>
  );
}
