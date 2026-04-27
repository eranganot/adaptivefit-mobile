"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { logWorkout } from "@/app/(app)/workouts/actions";
import { cn } from "@/lib/utils/cn";

type WorkoutType = "run" | "strength" | "mobility" | "other";

function toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TYPE_LABELS: Record<WorkoutType, string> = {
  run: "🏃 Run",
  strength: "💪 Strength",
  mobility: "🧘 Mobility",
  other: "⚡ Other",
};

export function LogWorkoutForm() {
  const t = useTranslations("log");
  const router = useRouter();

  const [type, setType] = useState<WorkoutType>("run");
  const [performedAt, setPerformedAt] = useState(toLocalDatetimeString(new Date()));
  const [distanceKm, setDistanceKm] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [footPain, setFootPain] = useState<number | null>(null);
  const [otherPain, setOtherPain] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rpe === null) { setError("Please rate your effort (RPE)."); return; }
    if (footPain === null) { setError("Please rate your foot pain (0 = none)."); return; }

    setSaving(true);
    setError(null);

    try {
      const result = await logWorkout({
        type,
        performedAt: new Date(performedAt).toISOString(),
        distanceKm: distanceKm ? parseFloat(distanceKm) : undefined,
        durationMin: durationMin ? parseFloat(durationMin) : undefined,
        rpe,
        footPain,
        otherPain: otherPain || undefined,
        notes: notes || undefined,
      });

      if (result.success) {
        router.push("/home");
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-28">

      {/* ── Type ── */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">{t("type")}</label>
        <div className="grid grid-cols-2 gap-2">
          {(["run", "strength", "mobility", "other"] as WorkoutType[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setType(v)}
              className={cn(
                "rounded-xl border py-3 text-sm font-medium transition-colors",
                type === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50",
              )}
            >
              {TYPE_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Date/time ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("date")}</label>
        <input
          type="datetime-local"
          value={performedAt}
          onChange={(e) => setPerformedAt(e.target.value)}
          className="w-full rounded-xl border bg-card px-4 py-3 text-sm text-foreground"
        />
      </div>

      {/* ── Distance (runs only) ── */}
      {(type === "run" || type === "other") && (
        <div>
          <label className="mb-1 block text-sm font-medium">{t("distance")}</label>
          <div className="relative">
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="0.0"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              className="w-full rounded-xl border bg-card px-4 py-3 pr-14 text-sm"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">km</span>
          </div>
        </div>
      )}

      {/* ── Duration ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("duration")}</label>
        <div className="relative">
          <input
            type="number"
            min="1"
            placeholder="0"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            className="w-full rounded-xl border bg-card px-4 py-3 pr-14 text-sm"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">min</span>
        </div>
      </div>

      {/* ── RPE 1-10 ── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm font-medium">{t("rpe")}</label>
          {rpe !== null && (
            <span className="text-lg font-bold text-primary">{rpe}/10</span>
          )}
        </div>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRpe(v)}
              className={cn(
                "aspect-square rounded-lg text-sm font-semibold transition-colors",
                rpe === v
                  ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1"
                  : v <= 4
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : v <= 7
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  : "bg-red-100 text-red-800 hover:bg-red-200",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">1 = very easy · 10 = all-out</p>
      </div>

      {/* ── Foot pain 0-10 ── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm font-medium">{t("footPain")}</label>
          {footPain !== null && (
            <span className={cn(
              "text-lg font-bold",
              footPain <= 3 ? "text-emerald-600" : footPain <= 6 ? "text-amber-600" : "text-red-600",
            )}>
              {footPain}/10
            </span>
          )}
        </div>
        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setFootPain(v)}
              className={cn(
                "aspect-square rounded-lg text-sm font-semibold transition-colors",
                footPain === v
                  ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1"
                  : v <= 3
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : v <= 6
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  : "bg-red-100 text-red-800 hover:bg-red-200",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">0 = no pain · 10 = severe</p>
      </div>

      {/* ── Notes ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("notes")}</label>
        <textarea
          rows={3}
          placeholder="How did it feel? EN or HE — Gemini reads both."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full resize-none rounded-xl border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* ── Other pain ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("otherPain")}</label>
        <input
          type="text"
          placeholder="e.g. knee, hip…"
          value={otherPain}
          onChange={(e) => setOtherPain(e.target.value)}
          className="w-full rounded-xl border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={saving || rpe === null || footPain === null}
        className="w-full rounded-xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-opacity disabled:opacity-50"
      >
        {saving ? t("saving") : t("save")}
      </button>
    </form>
  );
}
