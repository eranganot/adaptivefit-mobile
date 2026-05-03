"use client";

import { useEffect, useRef, useCallback } from "react";

export interface WorkoutDraft {
  rpe: number | null;
  painSelected: boolean | null;
  notes: string;
  /** Photo File objects can't be serialized — store metadata only so the
   *  user knows a photo was attached and can re-attach if they navigate away. */
  photoMeta: { name: string; type: string; size: number } | null;
}

const EMPTY_DRAFT: WorkoutDraft = {
  rpe: null,
  painSelected: null,
  notes: "",
  photoMeta: null,
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
