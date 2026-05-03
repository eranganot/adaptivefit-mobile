"use client";

import { useState } from "react";
import { Check, Frown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { updateWorkout } from "@/lib/workouts/actions";
import type { RecentWorkout } from "@/lib/workouts/actions";

interface EditWorkoutFormProps {
  workout: RecentWorkout;
  onSaved: () => void;
  onCancel: () => void;
}

const RPE_OPTIONS = [
  { label: "Easy", sublabel: "1–3", value: 2 },
  { label: "Moderate", sublabel: "4–6", value: 5 },
  { label: "Hard", sublabel: "7–9", value: 8 },
  { label: "Max", sublabel: "10", value: 10 },
];

/** Maps a raw rpe integer to the nearest RPE option value */
function snapRpe(rpe: number): number {
  if (rpe <= 3) return 2;
  if (rpe <= 6) return 5;
  if (rpe <= 9) return 8;
  return 10;
}

export function EditWorkoutForm({ workout, onSaved, onCancel }: EditWorkoutFormProps) {
  const [selectedRpe, setSelectedRpe] = useState<number>(snapRpe(workout.rpe));
  const [painSelected, setPainSelected] = useState<boolean>(workout.footPain > 0);
  const [notes, setNotes] = useState(workout.notesRaw ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateWorkout(workout.id, {
      rpe: selectedRpe,
      footPain: painSelected ? 6 : 0,
      notes: notes || undefined,
    });
    setSaving(false);
    if (result.success) {
      onSaved();
    } else {
      setError(result.error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* RPE */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
          Effort level
        </label>
        <div className="grid grid-cols-2 gap-2">
          {RPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelectedRpe(opt.value)}
              className={cn(
                "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                selectedRpe === opt.value
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600",
              )}
            >
              <div>{opt.label}</div>
              <div className={cn("text-[10px] font-normal", selectedRpe === opt.value ? "" : "opacity-60")}>
                {opt.sublabel}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Pain */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
          Any pain?
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPainSelected(false)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
              !painSelected
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
            )}
          >
            <Check className="h-3.5 w-3.5" /> No Pain
          </button>
          <button
            type="button"
            onClick={() => setPainSelected(true)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
              painSelected
                ? "bg-rose-600 text-white"
                : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
            )}
          >
            <Frown className="h-3.5 w-3.5" /> Yes, Pain
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
          Notes
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="How did it feel?"
          className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-700 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
