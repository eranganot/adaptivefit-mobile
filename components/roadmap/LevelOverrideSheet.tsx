"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { setManualLevel } from "@/app/(app)/roadmap/actions";
import { useRouter } from "next/navigation";

interface LevelOverrideSheetProps {
  currentLevel: number;
  open: boolean;
  onClose: () => void;
}

export function LevelOverrideSheet({ currentLevel, open, onClose }: LevelOverrideSheetProps) {
  const router = useRouter();
  const [selectedLevel, setSelectedLevel] = useState(currentLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleApply = async () => {
    setSaving(true);
    setError(null);
    const result = await setManualLevel(selectedLevel);
    setSaving(false);
    if (result.success) {
      router.refresh();
      onClose();
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl bg-white dark:bg-slate-900 shadow-xl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Set Coach Level
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Lock your level for 7 days
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 pb-8 space-y-5">
          {/* Level grid */}
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={cn(
                  "rounded-2xl py-3 text-sm font-bold transition-colors",
                  selectedLevel === lvl
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700",
                )}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Description */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {selectedLevel <= 2 && "Beginner — 1–2 runs/week, 1–3 km each, easy effort."}
              {selectedLevel >= 3 && selectedLevel <= 4 && "Casual runner — 2–3 runs/week, 3–5 km each."}
              {selectedLevel >= 5 && selectedLevel <= 6 && "Regular runner — 3–4 runs/week, 5–8 km each."}
              {selectedLevel >= 7 && selectedLevel <= 8 && "Experienced — 4–5 runs/week, 8–12 km each."}
              {selectedLevel >= 9 && "Advanced — 5+ runs/week, 12+ km each, race-ready paces."}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
              Override locks in for 7 days, then the coach resumes normal progression.
            </p>
          </div>

          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={saving}
              className="flex-1 rounded-2xl bg-indigo-600 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-700 transition-colors"
            >
              {saving ? "Applying…" : `Set Level ${selectedLevel}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
