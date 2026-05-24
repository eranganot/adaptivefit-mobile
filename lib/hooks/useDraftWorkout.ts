"use client";

import { useEffect, useRef, useCallback } from "react";

/** Subset of workout_logs.type. Mirrors the DB enum so a stale draft can't
 *  hold an invalid value — the union narrows at compile-time. */
export type WorkoutType = "run" | "strength" | "mobility" | "other";

/** One row of the strength sheet. Maps 1:1 to a strength_logs DB row.
 *  Stored as strings in the draft so half-typed values round-trip
 *  without coercion to NaN — converted at submit time. */
export interface StrengthEntryDraft {
  /** Free-text or one of the common exercise keys. Empty string == not
   *  yet filled. Validated/normalized server-side. */
  exercise: string;
  /** Weight in kilograms. Empty string until the user types. */
  weightKg: string;
  /** Reps per set. */
  reps: string;
  /** Number of sets at this weight × reps. Defaults to "1" in the UI. */
  sets: string;
}

/** Single blank strength row used both as initial state and as the "add row"
 *  template. Hoisted so identity doesn't shift between renders. */
export const EMPTY_STRENGTH_ENTRY: StrengthEntryDraft = {
  exercise: "",
  weightKg: "",
  reps: "",
  sets: "1",
};

export interface WorkoutDraft {
  rpe: number | null;
  painSelected: boolean | null;
  notes: string;
  /** Photo File objects can't be serialized — store metadata only so the
   *  user knows a photo was attached and can re-attach if they navigate away. */
  photoMeta: { name: string; type: string; size: number } | null;
  /** Workout type (Phase 8b.2). Null until the user picks; defaults to "run"
   *  for back-compat — every workout was a run before the type picker existed. */
  type: WorkoutType | null;
  /** Manual distance entry in km. Only meaningful for type === "run". Stored
   *  as string so a half-typed value (e.g. "5.") round-trips through the
   *  draft without being coerced to NaN. Converted to number at submit. */
  distanceKm: string;
  /** Manual duration entered as separate hours + minutes for thumb-friendly
   *  input. Both stored as strings for the same reason as distanceKm. */
  durationHours: string;
  durationMinutes: string;
  /** Strength sheet rows (Phase 8b.3). Only meaningful for type ===
   *  "strength". Empty when type is anything else; the UI always shows at
   *  least one blank row in the sheet but doesn't persist a single all-
   *  empty row to localStorage (would just be noise). */
  strengthEntries: StrengthEntryDraft[];
}

const EMPTY_DRAFT: WorkoutDraft = {
  rpe: null,
  painSelected: null,
  notes: "",
  photoMeta: null,
  type: null,
  distanceKm: "",
  durationHours: "",
  durationMinutes: "",
  strengthEntries: [],
};

function todayKey(): string {
  return `postWorkoutDraft:${new Date().toISOString().split("T")[0]}`;
}

function readDraft(): WorkoutDraft {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return EMPTY_DRAFT;
    return { ...EMPTY_DRAFT, ...JSON.parse(raw) };
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeDraft(draft: WorkoutDraft): void {
  try {
    localStorage.setItem(todayKey(), JSON.stringify(draft));
  } catch {
    // Ignore storage quota errors
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(todayKey());
  } catch {
    // Ignore
  }
}

/**
 * Manages a today-keyed draft of the post-workout form in localStorage.
 * Returns the initial draft (hydrated on first call) and helper functions.
 */
export function useDraftWorkout(): {
  initialDraft: WorkoutDraft;
  saveDraft: (draft: WorkoutDraft) => void;
  clearDraft: () => void;
} {
  // Read once on mount — stable reference for the lifetime of the component
  const initialDraftRef = useRef<WorkoutDraft>(EMPTY_DRAFT);
  const hydratedRef = useRef(false);

  if (!hydratedRef.current) {
    // Reading synchronously on first render (safe — only runs on client via "use client")
    try {
      initialDraftRef.current = readDraft();
    } catch {
      initialDraftRef.current = EMPTY_DRAFT;
    }
    hydratedRef.current = true;
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraft = useCallback((draft: WorkoutDraft) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => writeDraft(draft), 500);
  }, []);

  // Clean up pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    initialDraft: initialDraftRef.current,
    saveDraft,
    clearDraft,
  };
}
