"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Plus, Trash2, Loader2 } from "lucide-react";
import { logWeight, deleteWeightEntry } from "@/lib/body-metrics/actions";

export type WeightEntry = {
  id: string;
  date: string;       // "YYYY-MM-DD"
  weightKg: number;
};

interface Props {
  entries: WeightEntry[];
}

export function BodyMetricsSection({ entries }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [dateInput, setDateInput] = useState(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()),
  );
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleLog = async () => {
    const kg = parseFloat(input);
    if (isNaN(kg) || kg <= 0) {
      setError("Enter a valid weight in kg");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const result = await logWeight(kg, dateInput);
    setSaving(false);
    if (result.success) {
      setSuccess(`Logged ${kg} kg for ${dateInput}`);
      setInput("");
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    const result = await deleteWeightEntry(id);
    setDeletingId(null);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Scale className="w-5 h-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Weight Log</h2>
      </div>

      {/* Entry form */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Weight (kg)
          </label>
          <input
            type="number"
            step="0.1"
            min="20"
            max="500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 72.5"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Date
          </label>
          <input
            type="date"
            value={dateInput}
            max={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date())}
            onChange={(e) => setDateInput(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <button
          onClick={handleLog}
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Log
        </button>
      </div>

      {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
      {success && <p className="text-xs text-emerald-600 dark:text-emerald-400">{success}</p>}

      {/* Recent entries */}
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
          No weight entries yet. Log your first measurement above.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800 px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {entry.weightKg} kg
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {new Date(entry.date + "T12:00:00").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                disabled={deletingId === entry.id}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-500 transition-colors disabled:opacity-40"
                title="Delete entry"
              >
                {deletingId === entry.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
