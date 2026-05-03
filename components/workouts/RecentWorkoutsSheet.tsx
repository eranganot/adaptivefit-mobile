"use client";

import { useState, useEffect } from "react";
import { X, Pencil, Trash2 } from "lucide-react";
import { getRecentWorkouts, deleteWorkout } from "@/lib/workouts/actions";
import type { RecentWorkout } from "@/lib/workouts/actions";
import { EditWorkoutForm } from "./EditWorkoutForm";

interface RecentWorkoutsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after any mutation so home page can revalidate */
  onMutated: () => void;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function RecentWorkoutsSheet({ open, onClose, onMutated }: RecentWorkoutsSheetProps) {
  const [workouts, setWorkouts] = useState<RecentWorkout[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getRecentWorkouts(10)
      .then(setWorkouts)
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workout? Your coach state and roadmap will be recomputed.")) return;
    setDeletingId(id);
    setError(null);
    const result = await deleteWorkout(id);
    setDeletingId(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    onMutated();
  };

  const handleEditSaved = (_id: string) => {
    setEditingId(null);
    // Refresh list
    getRecentWorkouts(10).then(setWorkouts);
    onMutated();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl bg-white dark:bg-slate-900 shadow-xl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Recent Workouts
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-2 pb-8">
          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 px-1">{error}</p>
          )}

          {loading && (
            <p className="text-sm text-slate-500 text-center py-6">Loading…</p>
          )}

          {!loading && workouts.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">
              No workouts logged yet.
            </p>
          )}

          {workouts.map((w) => (
            <div key={w.id} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {editingId === w.id ? (
                <div className="p-4">
                  <EditWorkoutForm
                    workout={w}
                    onSaved={() => handleEditSaved(w.id)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                      {w.type} — {formatDate(w.performedAt)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      RPE {w.rpe} · {w.footPain > 0 ? "Pain reported" : "No pain"}
                      {w.distanceKm ? ` · ${w.distanceKm} km` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => setEditingId(w.id)}
                      className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      disabled={deletingId === w.id}
                      className="h-8 w-8 rounded-full flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
