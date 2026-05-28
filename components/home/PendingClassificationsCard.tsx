"use client";

/**
 * Pending-classifications card — surfaces external HC sessions whose
 * auto-classifier landed in the "ambiguous" bucket. The user taps thumbs-up
 * (training) or thumbs-down (activity) per row. Once classified, the row
 * disappears optimistically; if the server rejects, the row reappears with
 * an error toast.
 *
 * Only renders when there's at least one pending row — invisible on days
 * with no ambiguous sessions, which is the common case.
 */

import { useState, useTransition } from "react";
import { Dumbbell, Footprints, X, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { PendingClassification } from "@/app/(app)/home/sessionClassificationActions";
import { setSessionClassification } from "@/app/(app)/home/sessionClassificationActions";
import { cn } from "@/lib/utils/cn";

const SOURCE_APP_LABELS: Record<string, string> = {
  "com.strava": "Strava",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
};

interface Props {
  pending: PendingClassification[];
}

function formatStart(date: Date, now: Date): string {
  // Asia/Jerusalem to match the chart's bucketing
  const tz = "Asia/Jerusalem";
  const startMidnight = new Date(date);
  startMidnight.setHours(0, 0, 0, 0);
  const nowMidnight = new Date(now);
  nowMidnight.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor(
    (nowMidnight.getTime() - startMidnight.getTime()) / 86400000,
  );
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  const dateLabel = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
  return `${dateLabel}, ${time}`;
}

export function PendingClassificationsCard({ pending }: Props) {
  // Optimistic local state — when the user taps a button, we immediately
  // drop the row from view. If the server returns an error, restore +
  // surface the error.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [errored, setErrored] = useState<{ id: string; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const visible = pending.filter((p) => !hidden.has(p.id));
  if (visible.length === 0) return null;

  const handleClassify = (id: string, value: "training" | "activity") => {
    setErrored(null);
    setHidden((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const result = await setSessionClassification(id, value);
      if (!result.success) {
        // Restore the row + surface the error.
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setErrored({ id, message: result.error });
      } else {
        // Server revalidated paths — Next.js will refetch on next nav.
        // We also kick off a soft router refresh so the chart reflects
        // the new classification without a page reload.
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-4">
      <div className="mb-3 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {visible.length === 1
              ? "1 session needs classifying"
              : `${visible.length} sessions need classifying`}
          </h3>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">
            We&apos;re not sure if these were workouts or casual activity. Tap to
            tell us so the chart and coach get it right.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {visible.map((p) => {
          const km = p.distanceM != null && p.distanceM > 0 ? p.distanceM / 1000 : null;
          const minutes = Math.round(p.durationSec / 60);
          const sourceLabel = SOURCE_APP_LABELS[p.sourceApp ?? ""] ?? p.sourceApp ?? "Unknown source";
          const start = new Date(p.startTime);
          return (
            <div
              key={p.id}
              className="rounded-xl bg-white dark:bg-slate-900 p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {formatStart(start, new Date())} · {minutes} min{km != null ? ` · ${km.toFixed(2)} km` : ""}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {sourceLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleClassify(p.id, "training")}
                disabled={isPending}
                className={cn(
                  "flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700",
                  isPending && "opacity-50 cursor-not-allowed",
                )}
                aria-label="Mark as training"
              >
                <Dumbbell className="h-3.5 w-3.5" />
                Training
              </button>
              <button
                type="button"
                onClick={() => handleClassify(p.id, "activity")}
                disabled={isPending}
                className={cn(
                  "flex items-center gap-1.5 rounded-full bg-slate-200 dark:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 transition-colors hover:bg-slate-300 dark:hover:bg-slate-600",
                  isPending && "opacity-50 cursor-not-allowed",
                )}
                aria-label="Mark as casual activity"
              >
                <Footprints className="h-3.5 w-3.5" />
                Activity
              </button>
            </div>
          );
        })}
      </div>
      {errored && (
        <div className="mt-3 rounded-xl bg-rose-100 dark:bg-rose-900/30 px-3 py-2 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <X className="h-3.5 w-3.5" />
          Couldn&apos;t save: {errored.message}
        </div>
      )}
    </div>
  );
}
