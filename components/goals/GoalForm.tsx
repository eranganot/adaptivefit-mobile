"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGoal } from "@/lib/goals/actions";
import { cn } from "@/lib/utils/cn";

type GoalCategory = "running" | "body_shape" | "weight_loss" | "strength";

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function mmssToSec(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

interface GoalFormProps {
  onSuccess?: () => void;
}

const CATEGORIES: { key: GoalCategory; label: string; emoji: string; description: string }[] = [
  { key: "running", label: "Running", emoji: "🏃", description: "5k time, weekly volume, race goals" },
  { key: "weight_loss", label: "Weight Loss", emoji: "⚖️", description: "Target weight with cardio plan" },
  { key: "body_shape", label: "Body Shape", emoji: "💪", description: "Body composition & training mix" },
  { key: "strength", label: "Strength", emoji: "🏋️", description: "Lift PRs — bench, squat, deadlift" },
];

export function GoalForm({ onSuccess }: GoalFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<GoalCategory>("running");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Running fields
  const [runType, setRunType] = useState<"5k_time" | "10k_time" | "weekly_volume_km">("5k_time");
  const [runTimeValue, setRunTimeValue] = useState("25:00");
  const [runVolume, setRunVolume] = useState("20");

  // Weight loss fields
  const [targetWeightKg, setTargetWeightKg] = useState("");
  const [currentWeightKg, setCurrentWeightKg] = useState("");

  // Body shape fields
  const [bodyFatTarget, setBodyFatTarget] = useState("");
  const [trainingMix, setTrainingMix] = useState(60); // % strength

  // Strength fields
  const [bench5rm, setBench5rm] = useState("");
  const [squat5rm, setSquat5rm] = useState("");
  const [deadlift5rm, setDeadlift5rm] = useState("");

  // Shared
  const [sessionsPerWeek, setSessionsPerWeek] = useState("3");
  const [targetDate, setTargetDate] = useState(todayPlusDays(90));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      let result: Awaited<ReturnType<typeof saveGoal>>;

      if (category === "running") {
        if (runType === "5k_time" || runType === "10k_time") {
          const sec = mmssToSec(runTimeValue);
          if (!sec || sec <= 0) {
            setError("Enter a valid time in mm:ss format (e.g. 24:30).");
            setSaving(false);
            return;
          }
          result = await saveGoal({
            category: "running",
            type: runType,
            targetValue: sec,
            targetUnit: "sec",
            targetDate,
            sessionsPerWeek: parseInt(sessionsPerWeek) || 3,
          });
        } else {
          const vol = parseFloat(runVolume);
          if (!vol || vol <= 0) {
            setError("Enter a valid weekly volume.");
            setSaving(false);
            return;
          }
          result = await saveGoal({
            category: "running",
            type: "weekly_volume_km",
            targetValue: vol,
            targetUnit: "km",
            targetDate,
            sessionsPerWeek: parseInt(sessionsPerWeek) || 3,
          });
        }
      } else if (category === "weight_loss") {
        const tw = parseFloat(targetWeightKg);
        const cw = parseFloat(currentWeightKg);
        if (!tw || tw <= 0) { setError("Enter your target weight."); setSaving(false); return; }
        if (!cw || cw <= 0) { setError("Enter your current weight."); setSaving(false); return; }
        if (tw >= cw) { setError("Target weight must be less than current weight."); setSaving(false); return; }
        result = await saveGoal({
          category: "weight_loss",
          type: "custom",
          targetValue: tw,
          targetUnit: "kg",
          targetDate,
          currentValue: cw,
          sessionsPerWeek: parseInt(sessionsPerWeek) || 3,
        });
      } else if (category === "body_shape") {
        const bf = parseFloat(bodyFatTarget);
        if (!bf || bf <= 0 || bf > 50) { setError("Enter a valid body-fat % target (e.g. 18)."); setSaving(false); return; }
        result = await saveGoal({
          category: "body_shape",
          type: "custom",
          targetValue: bf,
          targetUnit: "pct",
          targetDate,
          trainingMixPct: trainingMix,
          sessionsPerWeek: parseInt(sessionsPerWeek) || 3,
        });
      } else {
        // strength
        const b = parseFloat(bench5rm) || 0;
        const s = parseFloat(squat5rm) || 0;
        const d = parseFloat(deadlift5rm) || 0;
        if (!b && !s && !d) { setError("Enter at least one target lift."); setSaving(false); return; }
        result = await saveGoal({
          category: "strength",
          type: "custom",
          targetValue: Math.max(b, s, d),
          targetUnit: "kg",
          targetDate,
          trainingMixPct: 80,
          targetLifts: { bench5rm: b || undefined, squat5rm: s || undefined, deadlift5rm: d || undefined },
          sessionsPerWeek: parseInt(sessionsPerWeek) || 3,
        });
      }

      if (result.success) {
        if (onSuccess) { onSuccess(); } else { router.push("/home"); }
        router.refresh();
      } else {
        setError(result.error);
        setSaving(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  // ── Step 1: pick category ──────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          What are you training for?
        </p>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => { setCategory(cat.key); setStep(2); }}
            className="w-full flex items-center gap-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-left hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
          >
            <span className="text-2xl">{cat.emoji}</span>
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{cat.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{cat.description}</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  // ── Step 2: category-specific form ────────────────────────────
  const selectedCat = CATEGORIES.find((c) => c.key === category)!;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Back header */}
      <button
        type="button"
        onClick={() => { setStep(1); setError(null); }}
        className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 font-medium mb-2"
      >
        ← {selectedCat.emoji} {selectedCat.label}
      </button>

      {/* Running form */}
      {category === "running" && (
        <>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Goal type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["5k_time", "10k_time", "weekly_volume_km"] as const).map((rt) => (
                <button key={rt} type="button" onClick={() => setRunType(rt)}
                  className={cn("rounded-xl py-2 text-xs font-semibold transition-colors",
                    runType === rt ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300")}>
                  {rt === "5k_time" ? "5K Time" : rt === "10k_time" ? "10K Time" : "Weekly km"}
                </button>
              ))}
            </div>
          </div>
          {(runType === "5k_time" || runType === "10k_time") ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target time (mm:ss)
              </label>
              <input type="text" inputMode="numeric" placeholder={runType === "5k_time" ? "25:00" : "55:00"}
                value={runTimeValue} onChange={(e) => setRunTimeValue(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-mono" />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target weekly volume (km)
              </label>
              <input type="number" min="1" step="0.5" placeholder="20"
                value={runVolume} onChange={(e) => setRunVolume(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm" />
            </div>
          )}
        </>
      )}

      {/* Weight loss form */}
      {category === "weight_loss" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Current weight (kg)</label>
              <input type="number" min="30" max="300" step="0.5" placeholder="85"
                value={currentWeightKg} onChange={(e) => setCurrentWeightKg(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Target weight (kg)</label>
              <input type="number" min="30" max="300" step="0.5" placeholder="75"
                value={targetWeightKg} onChange={(e) => setTargetWeightKg(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm" />
            </div>
          </div>
          {currentWeightKg && targetWeightKg && parseFloat(currentWeightKg) > parseFloat(targetWeightKg) && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2.5">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                Gap: {(parseFloat(currentWeightKg) - parseFloat(targetWeightKg)).toFixed(1)} kg to lose
              </p>
            </div>
          )}
        </>
      )}

      {/* Body shape form */}
      {category === "body_shape" && (
        <>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Target body-fat %</label>
            <input type="number" min="5" max="40" step="0.5" placeholder="18"
              value={bodyFatTarget} onChange={(e) => setBodyFatTarget(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Training mix — strength: <span className="text-indigo-600 dark:text-indigo-400">{trainingMix}%</span> / cardio: {100 - trainingMix}%
            </label>
            <input type="range" min="0" max="100" step="10" value={trainingMix}
              onChange={(e) => setTrainingMix(parseInt(e.target.value))}
              className="w-full accent-indigo-600" />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>All cardio</span><span>All strength</span>
            </div>
          </div>
        </>
      )}

      {/* Strength form */}
      {category === "strength" && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">Enter your target 5-rep max lifts (leave blank to skip).</p>
          <div className="space-y-3">
            {[
              { label: "Bench press 5RM (kg)", value: bench5rm, set: setBench5rm },
              { label: "Squat 5RM (kg)", value: squat5rm, set: setSquat5rm },
              { label: "Deadlift 5RM (kg)", value: deadlift5rm, set: setDeadlift5rm },
            ].map((lift) => (
              <div key={lift.label}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{lift.label}</label>
                <input type="number" min="0" step="2.5" placeholder="e.g. 80"
                  value={lift.value} onChange={(e) => lift.set(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm" />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Shared: sessions/week + target date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Sessions / week</label>
          <select value={sessionsPerWeek} onChange={(e) => setSessionsPerWeek(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm">
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}×/wk</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Target date</label>
          <input type="date" value={targetDate} min={todayPlusDays(7)} onChange={(e) => setTargetDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm" />
        </div>
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <button type="submit" disabled={saving}
        className="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-700 transition-colors">
        {saving ? "Saving…" : `Set ${selectedCat.label} Goal`}
      </button>
    </form>
  );
}
