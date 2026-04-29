"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveGoal } from "@/app/(app)/goals/actions";
import { cn } from "@/lib/utils/cn";

type GoalType = "5k_time" | "10k_time" | "weekly_volume_km" | "sessions_per_week" | "custom";
type TargetUnit = "sec" | "km" | "sessions" | "free";

const GOAL_TYPES: GoalType[] = [
  "5k_time",
  "10k_time",
  "weekly_volume_km",
  "sessions_per_week",
  "custom",
];

const TIME_TYPES = new Set<GoalType>(["5k_time", "10k_time"]);

function unitForType(type: GoalType): TargetUnit {
  if (type === "weekly_volume_km") return "km";
  if (type === "sessions_per_week") return "sessions";
  if (TIME_TYPES.has(type)) return "sec";
  return "free";
}

/** Convert "mm:ss" string → total seconds */
function mmssToSec(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/** Convert total seconds → "mm:ss" display */
function secToMmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

interface GoalFormProps {
  initialType?: GoalType;
  initialTargetValue?: number; // always in raw unit (seconds for time types)
  initialTargetDate?: string;
  initialNote?: string;
  onSuccess?: () => void;
}

export function GoalForm({
  initialType = "5k_time",
  initialTargetValue,
  initialTargetDate,
  initialNote = "",
  onSuccess,
}: GoalFormProps) {
  const t = useTranslations("goals");
  const router = useRouter();

  const [type, setType] = useState<GoalType>(initialType);
  const [timeValue, setTimeValue] = useState<string>(() => {
    if (initialTargetValue && TIME_TYPES.has(initialType)) {
      return secToMmss(initialTargetValue);
    }
    return "25:00"; // default 5k target
  });
  const [numValue, setNumValue] = useState<string>(() => {
    if (initialTargetValue && !TIME_TYPES.has(initialType)) {
      return initialTargetValue.toString();
    }
    return "";
  });
  const [targetDate, setTargetDate] = useState(initialTargetDate ?? todayPlusDays(90));
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTime = TIME_TYPES.has(type);

  function handleTypeChange(t: GoalType) {
    setType(t);
    setError(null);
    // Reset to sensible defaults when switching types
    if (TIME_TYPES.has(t)) setTimeValue(t === "5k_time" ? "25:00" : "55:00");
    else setNumValue("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let targetValue: number;
    if (isTime) {
      const sec = mmssToSec(timeValue);
      if (sec === null || sec <= 0) {
        setError("Enter a valid time in mm:ss format (e.g. 24:30).");
        return;
      }
      targetValue = sec;
    } else {
      const v = parseFloat(numValue);
      if (isNaN(v) || v <= 0) {
        setError("Enter a valid positive number.");
        return;
      }
      targetValue = v;
    }

    if (!targetDate) {
      setError("Please set a target date.");
      return;
    }

    setSaving(true);
    try {
      const result = await saveGoal({
        type,
        targetValue,
        targetUnit: unitForType(type),
        targetDate,
        note: note || undefined,
      });

      if (result.success) {
        if (onSuccess) {
          onSuccess();
        } else {
          router.push("/home");
        }
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

      {/* ── Goal type ── */}
      <div>
        <label className="mb-2 block text-sm font-medium">{t("type")}</label>
        <div className="grid grid-cols-1 gap-2">
          {GOAL_TYPES.map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => handleTypeChange(gt)}
              className={cn(
                "rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
                type === gt
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50",
              )}
            >
              {t(`type.${gt}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      </div>

      {/* ── Target value ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("targetValue")}</label>
        {isTime ? (
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              placeholder="mm:ss"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="w-full rounded-xl border bg-card px-4 py-3 pr-20 text-sm font-mono"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              min:sec
            </span>
          </div>
        ) : (
          <div className="relative">
            <input
              type="number"
              step={type === "weekly_volume_km" ? "0.5" : "1"}
              min="0"
              placeholder={type === "weekly_volume_km" ? "40" : "4"}
              value={numValue}
              onChange={(e) => setNumValue(e.target.value)}
              className="w-full rounded-xl border bg-card px-4 py-3 pr-24 text-sm"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {type === "weekly_volume_km" ? "km/wk" : type === "sessions_per_week" ? "/wk" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ── Target date ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("targetDate")}</label>
        <input
          type="date"
          value={targetDate}
          min={todayPlusDays(1)}
          onChange={(e) => setTargetDate(e.target.value)}
          className="w-full rounded-xl border bg-card px-4 py-3 text-sm text-foreground"
        />
      </div>

      {/* ── Note ── */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("note")}</label>
        <textarea
          rows={2}
          placeholder="E.g. sub-25 at Tel Aviv 5k in October"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full resize-none rounded-xl border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-opacity disabled:opacity-50"
      >
        {saving ? "Saving…" : t("save")}
      </button>
    </form>
  );
}
