"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Brain, Check, Frown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useDraftWorkout,
  EMPTY_STRENGTH_ENTRY,
  type WorkoutType,
  type StrengthEntryDraft,
} from "@/lib/hooks/useDraftWorkout";

/** Common-lift dropdown options. "Other" reveals a free-text input. The
 *  string values land in strength_logs.exercise as-is; the analytics
 *  grouping uses the same key, so consistency matters. */
const COMMON_EXERCISES: { key: string; labelKey: string }[] = [
  { key: "bench_press", labelKey: "post.exerciseBench" },
  { key: "squat", labelKey: "post.exerciseSquat" },
  { key: "deadlift", labelKey: "post.exerciseDeadlift" },
  { key: "overhead_press", labelKey: "post.exerciseOhp" },
  { key: "row", labelKey: "post.exerciseRow" },
  { key: "other", labelKey: "post.exerciseOther" },
];

interface PostWorkoutProps {
  isSubmitting: boolean;
  prefillRpe?: number;
  /** When true, the workout came from the live GPS tracker — the type
   *  is forced to "run" and distance/duration are pre-supplied server-side
   *  from the linked run_sessions row. We hide both fields in that case
   *  so the user can't enter conflicting numbers. */
  hasLinkedRunSession?: boolean;
  onSubmit: (formData: {
    rpe: number;
    footPain: number;
    notes: string;
    photo: File | null;
    type: WorkoutType;
    /** Manual distance in km. Pass undefined to defer to server (e.g. when
     *  linked from a GPS run_session). */
    distanceKm?: number;
    /** Manual duration in seconds. Same deferral rule as distanceKm. */
    durationSec?: number;
    /** Strength sheet rows (Phase 8b.3). Only sent when type === "strength"
     *  and at least one row passes client-side validation. */
    strengthEntries?: Array<{
      exercise: string;
      weightKg: number;
      reps: number;
      sets: number;
    }>;
  }) => Promise<void>;
  onCancel: () => void;
}

type RPELevel = "easy" | "moderate" | "hard" | "max";

const RPE_OPTIONS: { key: RPELevel; label: string; sublabel: string; value: number }[] = [
  { key: "easy", label: "Easy", sublabel: "1–3", value: 2 },
  { key: "moderate", label: "Moderate", sublabel: "4–6", value: 5 },
  { key: "hard", label: "Hard", sublabel: "7–9", value: 8 },
  { key: "max", label: "Max", sublabel: "10", value: 10 },
];

const TYPE_OPTIONS: { key: WorkoutType; labelKey: string }[] = [
  { key: "run", labelKey: "post.typeRun" },
  { key: "strength", labelKey: "post.typeStrength" },
  { key: "mobility", labelKey: "post.typeMobility" },
  { key: "other", labelKey: "post.typeOther" },
];

export default function PostWorkout({
  isSubmitting,
  prefillRpe,
  hasLinkedRunSession = false,
  onSubmit,
  onCancel,
}: PostWorkoutProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { initialDraft, saveDraft, clearDraft } = useDraftWorkout();

  // Hydrate from draft; prefillRpe takes precedence if caller supplies it
  const [selectedRPE, setSelectedRPE] = useState<number | null>(
    prefillRpe ?? initialDraft.rpe,
  );
  const [painSelected, setPainSelected] = useState<boolean | null>(
    initialDraft.painSelected,
  );
  const [notes, setNotes] = useState(initialDraft.notes);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  // ── Type / distance / duration (Phase 8b.2) ────────────────────
  // A workout linked to a GPS run_session is always type='run'. The
  // type picker is hidden in that case to prevent the user from entering
  // a strength session that's actually attached to GPS coords. For all
  // other entry points we default to "run" (back-compat) but persist
  // any change to the draft.
  const [selectedType, setSelectedType] = useState<WorkoutType>(
    hasLinkedRunSession ? "run" : initialDraft.type ?? "run",
  );
  const [distanceKm, setDistanceKm] = useState<string>(initialDraft.distanceKm);
  const [durationHours, setDurationHours] = useState<string>(initialDraft.durationHours);
  const [durationMinutes, setDurationMinutes] = useState<string>(initialDraft.durationMinutes);

  // Strength entries (Phase 8b.3). Seed with one blank row when the user
  // is in strength mode but the draft is empty, so the sheet isn't an
  // empty wasteland on first open. Other types render no entries.
  const [strengthEntries, setStrengthEntries] = useState<StrengthEntryDraft[]>(
    () =>
      initialDraft.strengthEntries.length > 0
        ? initialDraft.strengthEntries
        : [{ ...EMPTY_STRENGTH_ENTRY }],
  );

  // Show distance/duration only for manual runs. Strength/mobility/other
  // get their volume signal through other paths (the strength sheet for
  // strength; nothing for mobility/other). Linked GPS runs already have
  // authoritative values server-side.
  const showRunMetrics = selectedType === "run" && !hasLinkedRunSession;
  const showStrengthSheet = selectedType === "strength";

  // ── Strength row handlers ─────────────────────────────────────
  const updateStrengthEntry = (idx: number, patch: Partial<StrengthEntryDraft>) => {
    setStrengthEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)),
    );
  };
  const addStrengthEntry = () => {
    setStrengthEntries((prev) => [...prev, { ...EMPTY_STRENGTH_ENTRY }]);
  };
  const removeStrengthEntry = (idx: number) => {
    setStrengthEntries((prev) => {
      // Never go below one row — the sheet always shows at least one input
      // group, easier than handling an empty state.
      if (prev.length <= 1) return [{ ...EMPTY_STRENGTH_ENTRY }];
      return prev.filter((_, i) => i !== idx);
    });
  };

  // Show a hint when a photo was attached in a previous session but can't be restored
  const hadPhotoAttached = initialDraft.photoMeta !== null;

  // Persist draft on every field change (debounced inside saveDraft).
  // Strength entries are persisted as-is (always at least one row in state);
  // the server tolerates and skips fully-blank rows.
  useEffect(() => {
    saveDraft({
      rpe: selectedRPE,
      painSelected,
      notes,
      photoMeta: photoFile
        ? { name: photoFile.name, type: photoFile.type, size: photoFile.size }
        : null,
      type: selectedType,
      distanceKm,
      durationHours,
      durationMinutes,
      strengthEntries,
    });
  }, [
    selectedRPE,
    painSelected,
    notes,
    photoFile,
    selectedType,
    distanceKm,
    durationHours,
    durationMinutes,
    strengthEntries,
    saveDraft,
  ]);

  const handlePhotoClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPhotoFile(file);
  };

  /** Parse manual run-metric inputs to numbers. Returns `undefined` instead
   *  of 0/NaN for empty/invalid fields so the server treats them as
   *  "not provided" rather than "explicitly zero" (which would zero out
   *  any future re-derivation from a linked run_session). */
  const parseRunMetrics = (): { distanceKm?: number; durationSec?: number } => {
    if (!showRunMetrics) return {};
    const dKm = parseFloat(distanceKm);
    const hours = parseInt(durationHours, 10);
    const mins = parseInt(durationMinutes, 10);
    const totalSec =
      (Number.isFinite(hours) ? hours : 0) * 3600 +
      (Number.isFinite(mins) ? mins : 0) * 60;
    return {
      distanceKm: Number.isFinite(dKm) && dKm > 0 ? dKm : undefined,
      durationSec: totalSec > 0 ? totalSec : undefined,
    };
  };

  /** Convert the string-typed draft entries into the numeric shape the
   *  server expects. Fully-blank rows (the seeded placeholder) are dropped
   *  silently; partially-filled invalid rows surface as form errors at
   *  submit time via `strengthErrors` below. */
  const parseStrengthEntries = (): Array<{
    exercise: string;
    weightKg: number;
    reps: number;
    sets: number;
  }> => {
    if (!showStrengthSheet) return [];
    return strengthEntries
      .map((e) => ({
        exercise: e.exercise.trim(),
        weightKg: parseFloat(e.weightKg),
        reps: parseInt(e.reps, 10),
        sets: parseInt(e.sets, 10),
      }))
      .filter(
        (e) =>
          e.exercise !== "" &&
          Number.isFinite(e.weightKg) && e.weightKg > 0 &&
          Number.isFinite(e.reps) && e.reps >= 1 &&
          Number.isFinite(e.sets) && e.sets >= 1,
      );
  };

  /** True iff at least one strength row would survive the filter in
   *  parseStrengthEntries. Used to gate the submit button so the user
   *  can't submit a strength workout with zero exercises (which the
   *  server would also reject — fail-fast at the UI level). */
  const hasAtLeastOneValidStrengthEntry = (): boolean => {
    if (!showStrengthSheet) return true;
    return parseStrengthEntries().length > 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRPE === null || painSelected === null) return;
    // Strength gate — require at least one valid exercise row before submit.
    if (showStrengthSheet && !hasAtLeastOneValidStrengthEntry()) return;

    const runMetrics = parseRunMetrics();
    const cleanStrength = parseStrengthEntries();
    await onSubmit({
      rpe: selectedRPE,
      footPain: painSelected ? 1 : 0,
      notes,
      photo: photoFile,
      type: selectedType,
      ...runMetrics,
      ...(showStrengthSheet ? { strengthEntries: cleanStrength } : {}),
    });

    // Clear draft after successful submit
    clearDraft();
  };

  const handleCancel = () => {
    const strengthHasContent = strengthEntries.some(
      (e) => e.exercise.trim() !== "" || e.weightKg !== "" || e.reps !== "",
    );
    const hasDraftData =
      selectedRPE !== null ||
      painSelected !== null ||
      notes.trim() !== "" ||
      photoFile !== null ||
      distanceKm !== "" ||
      durationHours !== "" ||
      durationMinutes !== "" ||
      strengthHasContent;
    if (hasDraftData && !confirm(t("post.discardDraft"))) return;
    clearDraft();
    onCancel();
  };

  const isFormValid =
    selectedRPE !== null &&
    painSelected !== null &&
    hasAtLeastOneValidStrengthEntry();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <h2 className="text-2xl font-bold tracking-tight">{t("post.title")}</h2>

      {/* Coach Intro Card */}
      <div className="flex gap-3 rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-950/30">
        <Brain className="h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" />
        <p className="text-sm text-indigo-900 dark:text-indigo-200">{t("post.coachIntro")}</p>
      </div>

      {/* Workout Type Picker — hidden when this log is attached to a live
          GPS run (the type is forced to 'run' in that case, see the
          hasLinkedRunSession guard at the top of the component). */}
      {!hasLinkedRunSession && (
        <div>
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            {t("post.typeLabel")}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSelectedType(opt.key)}
                className={cn(
                  "rounded-2xl px-2 py-3 text-sm font-semibold transition-colors",
                  selectedType === opt.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700",
                )}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual distance + duration — only for type='run' without a linked
          GPS session. Strength/mobility/other don't get these fields here
          (strength uses the dedicated sheet in #5). */}
      {showRunMetrics && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {t("post.distanceLabel")}
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder={t("post.distancePlaceholder")}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {t("post.durationLabel")}
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="23"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  placeholder={t("post.durationHoursPlaceholder")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
                  {t("post.durationHours")}
                </p>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="59"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder={t("post.durationMinutesPlaceholder")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
                  {t("post.durationMinutes")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strength sheet — only when type='strength'. Replaces the
          distance/duration block (mutually exclusive via showStrengthSheet
          vs showRunMetrics, both keyed off selectedType). */}
      {showStrengthSheet && (
        <div>
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            {t("post.strengthLabel")}
          </label>
          <div className="space-y-3">
            {strengthEntries.map((entry, idx) => {
              // Free-text exercise input shows when the dropdown is set to
              // "other" OR when the value doesn't match any known key (e.g.
              // hydrating from an older draft).
              const isCustom =
                entry.exercise !== "" &&
                !COMMON_EXERCISES.some((opt) => opt.key === entry.exercise);
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={isCustom ? "other" : entry.exercise || ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        // Picking "other" clears the value so the free-text
                        // input shows up empty (user is about to type a name).
                        updateStrengthEntry(idx, {
                          exercise: next === "other" ? "" : next,
                        });
                      }}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">{t("post.exercisePickPlaceholder")}</option>
                      {COMMON_EXERCISES.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeStrengthEntry(idx)}
                      className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                      aria-label={t("post.exerciseRemove")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {/* Free-text exercise input — shown when "Other" picked OR
                      the value doesn't match any key (older draft case). */}
                  {(isCustom || entry.exercise === "") && (
                    <input
                      type="text"
                      value={isCustom ? entry.exercise : ""}
                      onChange={(e) =>
                        updateStrengthEntry(idx, { exercise: e.target.value })
                      }
                      placeholder={t("post.exerciseCustomPlaceholder")}
                      className="w-full mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        value={entry.weightKg}
                        onChange={(e) =>
                          updateStrengthEntry(idx, { weightKg: e.target.value })
                        }
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
                        {t("post.strengthWeightUnit")}
                      </p>
                    </div>
                    <div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={entry.reps}
                        onChange={(e) =>
                          updateStrengthEntry(idx, { reps: e.target.value })
                        }
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
                        {t("post.strengthReps")}
                      </p>
                    </div>
                    <div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={entry.sets}
                        onChange={(e) =>
                          updateStrengthEntry(idx, { sets: e.target.value })
                        }
                        placeholder="1"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
                        {t("post.strengthSets")}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addStrengthEntry}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              {t("post.exerciseAdd")}
            </button>
          </div>
        </div>
      )}

      {/* RPE Chips */}
      <div>
        <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          {t("post.rpeLabel")}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {RPE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSelectedRPE(opt.value)}
              className={cn(
                "rounded-2xl px-4 py-3 text-sm font-semibold transition-colors",
                selectedRPE === opt.value
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700",
              )}
            >
              <div>{opt.label}</div>
              <div className={cn("text-xs font-normal", selectedRPE === opt.value ? "" : "opacity-70")}>
                {opt.sublabel}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Pain Segmented Control */}
      <div>
        <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          {t("post.painLabel")}
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPainSelected(false)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold transition-colors",
              painSelected === false
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            <Check className="h-5 w-5" />
            {t("post.painNo")}
          </button>
          <button
            type="button"
            onClick={() => setPainSelected(true)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold transition-colors",
              painSelected === true
                ? "bg-rose-600 text-white"
                : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            <Frown className="h-5 w-5" />
            {t("post.painYes")}
          </button>
        </div>
      </div>

      {/* Notes Textarea */}
      <div>
        <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {t("post.notesLabel")}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("post.notesPlaceholder")}
          rows={6}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {/* Photo Upload */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={handlePhotoClick}
          className="w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
        >
          {photoFile ? (
            <>✓ {t("post.photoAttached")}</>
          ) : hadPhotoAttached ? (
            <span className="text-amber-600 dark:text-amber-400">
              {t("post.photoReattach")}
            </span>
          ) : (
            t("post.photoLabel")
          )}
        </button>
      </div>

      {/* Cancel */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {t("post.cancel")}
        </button>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!isFormValid || isSubmitting}
        className={cn(
          "w-full rounded-2xl px-4 py-4 font-semibold transition-colors",
          isFormValid && !isSubmitting
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400",
        )}
      >
        {isSubmitting ? t("post.submitting") : t("post.submit")}
      </button>
    </form>
  );
}
