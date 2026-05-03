"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { acceptColdStart } from "@/app/(app)/home/coldStartActions";

interface ColdStartReviewModalProps {
  coldStartId: string;
  recommendedLevel: number;
  rationale: string;
  onDone: () => void;
}

export function ColdStartReviewModal({
  coldStartId,
  recommendedLevel,
  rationale,
  onDone,
}: ColdStartReviewModalProps) {
  const [selectedLevel, setSelectedLevel] = useState(recommendedLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setSaving(true);
    setError(null);
    const result = await acceptColdStart(coldStartId, selectedLevel);
    setSaving(false);
    if (result.success) {
      onDone();
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" aria-hidden />

      {/* Modal */}
      <div className="fixed inset-x-4 top-1/2 z-50 max-w-sm mx-auto -translate-y-1/2 rounded-3xl bg-white dark:bg-slate-900 shadow-2xl p-6">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
            <Brain className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
          </div>
        </div>

        <h2 className="text-center text-lg font-bold text-slate-900 dark:text-white mb-1">
          Coach Recommendation
        </h2>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mb-5">
          {rationale}
        </p>

        {/* Level display */}
        <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 px-5 py-4 mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-1">
            Recommended starting level
          </p>
          <p className="text-5xl font-bold text-indigo-700 dark:text-indigo-300">
            {recommendedLevel}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">out of 10</p>
        </div>

        {/* Override slider */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
            Override level: <span className="text-indigo-600 dark:text-indigo-400">{selectedLevel}</span>
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedLevel((l) => Math.max(1, l - 1))}
              disabled={selectedLevel <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <div className="flex flex-1 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setSelectedLevel(lvl)}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-semibold transition-colors",
                    selectedLevel === lvl
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSelectedLevel((l) => Math.min(10, l + 1))}
              disabled={selectedLevel >= 10}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-center">
            Level 1–3: beginner · 4–6: casual · 7–8: regular · 9–10: advanced
          </p>
        </div>

        {error && (
          <p className="mb-3 text-xs text-rose-600 dark:text-rose-400 text-center">{error}</p>
        )}

        <button
          onClick={handleAccept}
          disabled={saving}
          className="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving
            ? "Applying…"
            : selectedLevel === recommendedLevel
            ? "Accept Recommendation"
            : `Start at Level ${selectedLevel}`}
        </button>
      </div>
    </>
  );
}
