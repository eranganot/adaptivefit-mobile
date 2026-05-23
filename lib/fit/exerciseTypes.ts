/**
 * Health Connect ExerciseType ↔ display-label mapping.
 *
 * Health Connect's ExerciseSessionRecord uses an integer `exerciseType`
 * code (matching the EXERCISE_TYPE_* constants in androidx.health.connect.client.records.ExerciseSessionRecord).
 *
 * The kiwi-health plugin returns this either as a string name (lowercased,
 * e.g. "running") OR as the integer code, depending on plugin version. To
 * stay version-tolerant we accept both and normalize to the integer code
 * (which is what fit_sessions.activity_type stores).
 *
 * Reference (Android SDK constants):
 * https://developer.android.com/reference/androidx/health/connect/client/records/ExerciseSessionRecord
 */

// Subset of the ones we actually expect from runners + general activity.
// Add more as needed; codes match the SDK.
export const EXERCISE_TYPE_CODES: Record<string, number> = {
  badminton: 2,
  baseball: 3,
  basketball: 4,
  biking: 8,
  biking_stationary: 9,
  boot_camp: 10,
  boxing: 11,
  calisthenics: 13,
  cricket: 14,
  dancing: 16,
  elliptical: 25,
  exercise_class: 26,
  fencing: 27,
  football_american: 28,
  football_australian: 29,
  frisbee_disc: 31,
  golf: 32,
  guided_breathing: 33,
  gymnastics: 34,
  handball: 35,
  high_intensity_interval_training: 36,
  hiking: 37,
  ice_hockey: 38,
  ice_skating: 39,
  martial_arts: 44,
  paddling: 46,
  paragliding: 47,
  pilates: 48,
  racquetball: 50,
  rock_climbing: 51,
  roller_hockey: 52,
  rowing: 53,
  rowing_machine: 54,
  rugby: 55,
  running: 56,
  running_treadmill: 57,
  sailing: 58,
  scuba_diving: 59,
  skating: 60,
  skiing: 61,
  snowboarding: 62,
  snowshoeing: 63,
  soccer: 64,
  softball: 65,
  squash: 66,
  stair_climbing: 68,
  stair_climbing_machine: 69,
  strength_training: 70,
  stretching: 71,
  surfing: 72,
  swimming_open_water: 73,
  swimming_pool: 74,
  table_tennis: 75,
  tennis: 76,
  volleyball: 78,
  walking: 79,
  water_polo: 80,
  weightlifting: 81,
  wheelchair: 82,
  yoga: 83,
  other_workout: 0,
};

/**
 * Normalize whatever the plugin returns (string name OR int code) into the
 * SDK integer code. Falls back to 0 ("other_workout") on unknowns so we never
 * crash on a new exercise type.
 */
export function normalizeExerciseType(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const key = raw.toLowerCase().replace(/\s+/g, "_");
    return EXERCISE_TYPE_CODES[key] ?? 0;
  }
  return 0;
}

/**
 * Reverse map: int code → display label. Useful for the analytics UI.
 */
export function exerciseTypeLabel(code: number): string {
  for (const [name, c] of Object.entries(EXERCISE_TYPE_CODES)) {
    if (c === code) {
      // "strength_training" → "Strength training"
      return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
    }
  }
  return "Workout";
}
