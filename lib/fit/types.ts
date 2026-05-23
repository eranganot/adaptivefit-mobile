/**
 * Shared types for fitness data sync (Health Connect now, was Google Fit).
 *
 * Kept in its own file so the abstraction layer (lib/fit/healthConnect.ts,
 * marked "use client") and the server actions don't pull on each other.
 */

export interface FitDailyAggregate {
  date: string;                       // "YYYY-MM-DD" (UTC)
  steps: number | null;
  distanceM: number | null;
  activeMinutes: number | null;       // 8b: derived from session durations
  avgHr: number | null;
  calories: number | null;
}

/**
 * Workout session from Health Connect (Phase 8b).
 *
 * Pulled from `ExerciseSessionRecord`s — these are workouts originally
 * recorded by other apps (Strava, Samsung Health, Google Fit) that the
 * user has linked to Health Connect. AdaptiveFit's own GPS-tracked runs
 * live in `run_sessions` and are NOT duplicated here.
 *
 * Maps 1:1 to the existing `fit_sessions` table (originally built for
 * Google Fit), with `sourceApp` added in Phase 8b.
 */
export interface FitSessionSummary {
  /** Stable HC id — used as a dedupe key. Falls back to a deterministic
   *  hash of (startTime|endTime|sourceApp) when HC's id is absent. */
  fitSessionId: string;
  /** Numeric Health Connect ExerciseType code (e.g. 56 = RUNNING). We keep
   *  the number to stay schema-compatible with the Google-Fit era; a
   *  display-name map lives in lib/fit/exerciseTypes.ts (added 8b). */
  activityType: number;
  startTime: string;                  // ISO 8601
  endTime: string;                    // ISO 8601
  /** Optional per-session aggregates pulled from the same Health Connect
   *  store, scoped to the session's time range. */
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  steps: number | null;
  calories: number | null;
  /** Originating app package name from HC's metadata.dataOrigin
   *  (e.g. "com.strava", "com.google.android.apps.fitness"). */
  sourceApp: string | null;
}
