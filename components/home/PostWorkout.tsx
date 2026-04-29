"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Brain, Check, Frown, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PostWorkoutProps {
  isSubmitting: boolean;
  onSubmit: (formData: {
    rpe: number;
    footPain: number;
    notes: string;
    photo: File | null;
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

export default function PostWorkout({ isSubmitting, onSubmit, onCancel }: PostWorkoutProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedRPE, setSelectedRPE] = useState<number | null>(null);
  const [painSelected, setPainSelected] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRPE === null || painSelected === null) {
      return;
    }

    await onSubmit({
      rpe: selectedRPE,
      footPain: painSelected ? 1 : 0,
      notes,
      photo: photoFile,
    });
  };

  const isFormValid = selectedRPE !== null && painSelected !== null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <h2 className="text-2xl font-bold tracking-tight">{t("post.title")}</h2>

      {/* Coach Intro Card */}
      <div className="flex gap-3 rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-950/30">
        <Brain className="h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" />
        <p className="text-sm text-indigo-900 dark:text-indigo-200">{t("post.coachIntro")}</p>
      </div>

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
            <>
              ✓ {t("post.photoAttached")}
            </>
          ) : (
            t("post.photoLabel")
          )}
        </button>
      </div>

      {/* Cancel at top right - rendered as a pill */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
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
