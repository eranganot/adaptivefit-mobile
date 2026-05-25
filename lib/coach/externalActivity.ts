/**
 * Summarize external training activity from Health Connect ExerciseSession
 * records (sourced from Strava / Samsung Health / Google Fit / Fitbit etc.,
 * stored as `fit_sessions` rows). Used by the coach to reason about real
 * training when nothing was logged in AdaptiveFit directly.
 *
 * Why this matters: a user who runs a 5k on Strava and never opens the AF
 * log flow currently appears, to the AF coach, as "did nothing today" — so
 * the FSM doesn't promote (no greens) and the chat coach plans against
 * stale data. This summary makes their real training visible to both.
 *
 * Pure function. Caller queries the DB (or supplies in-memory rows for
 * tests) and passes the array in.
 */
import type { FitSession } from "@/lib/db/schema";

/**
 * Compact summary of external activity over a window. Keep flat + simple so
 * it's cheap to embed in Gemini prompts and to log alongside FSM rationale.
 */
export type ExternalActivitySummary = {
  /** Number of distinct sessions in the window. */
  count: number;
  /** Total active minutes summed across all sessions (rounded). */
  totalActiveMin: number;
  /** Total distance covered across all sessions in km (rounded to 0.1). */
  totalDistanceKm: number;
  /** Most recent session's end time (ISO 8601) or null if none. */
  lastSessionEndIso: string | null;
  /** Whole days since the most recent session, or null if none. */
  daysSinceLastSession: number | null;
  /** Counts of sessions grouped by sourceApp ("com.strava", "com.sec.android.app.shealth", etc.).
   *  Null sourceApp (legacy Google Fit rows) maps to the key "unknown". */
  sourcesByApp: Record<string, number>;
};

/**
 * Build a summary across the given sessions, scoped to `[since, until]`.
 *
 * Sessions whose timestamp window doesn't overlap [since, until] are ignored.
 * Sessions with invalid times (NaN, end <= start) are silently skipped.
 *
 * @param sessions Raw `fit_sessions` rows to consider.
 * @param since    Lower bound of the window (inclusive).
 * @param until    Upper bound of the window (inclusive). Defaults to `since + 30 days`
 *                 if not provided — matches the typical 30-day sync horizon so
 *                 callers can pass just "now" minus N days easily.
 * @param now      Reference "now" for the `daysSinceLastSession` calculation.
 *                 Defaults to `new Date()`. Explicit for deterministic tests.
 */
export function summarizeExternalActivity(
  sessions: Array<Pick<FitSession, "startTime" | "endTime" | "distanceM" | "sourceApp">>,
  since: Date,
  until: Date = new Date(since.getTime() + 30 * 24 * 60 * 60 * 1000),
  now: Date = new Date(),
): ExternalActivitySummary {
  let count = 0;
  let totalSec = 0;
  let totalMeters = 0;
  let lastEnd: Date | null = null;
  const sourcesByApp: Record<string, number> = {};

  for (const s of sessions) {
    const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime as unknown as string);
    const end = s.endTime instanceof Date ? s.endTime : new Date(s.endTime as unknown as string);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;
    // Window overlap: session must touch [since, until].
    if (end < since || start > until) continue;

    count += 1;
    totalSec += (end.getTime() - start.getTime()) / 1000;
    if (typeof s.distanceM === "number" && Number.isFinite(s.distanceM) && s.distanceM > 0) {
      totalMeters += s.distanceM;
    }
    if (!lastEnd || end > lastEnd) lastEnd = end;

    const appKey = s.sourceApp ?? "unknown";
    sourcesByApp[appKey] = (sourcesByApp[appKey] ?? 0) + 1;
  }

  const totalActiveMin = Math.round(totalSec / 60);
  const totalDistanceKm = Math.round((totalMeters / 1000) * 10) / 10;
  const lastSessionEndIso = lastEnd ? lastEnd.toISOString() : null;
  const daysSinceLastSession = lastEnd
    ? Math.floor((now.getTime() - lastEnd.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    count,
    totalActiveMin,
    totalDistanceKm,
    lastSessionEndIso,
    daysSinceLastSession,
    sourcesByApp,
  };
}

/** Pretty source-app names for the prompt. Falls back to the package name as-is. */
const SOURCE_APP_LABELS: Record<string, string> = {
  "com.strava": "Strava",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
  unknown: "unknown source",
};

/** Format a summary as a one-paragraph English string suitable for a Gemini prompt.
 *  Returns null when there's no external activity in the window — caller can
 *  omit the prompt section entirely in that case. */
export function formatExternalActivityForPrompt(
  summary: ExternalActivitySummary,
): string | null {
  if (summary.count === 0) return null;
  const sources = Object.entries(summary.sourcesByApp)
    .sort((a, b) => b[1] - a[1])
    .map(([app, n]) => `${SOURCE_APP_LABELS[app] ?? app} (${n})`)
    .join(", ");
  const recencyClause =
    summary.daysSinceLastSession === null
      ? ""
      : summary.daysSinceLastSession === 0
        ? "Most recent: today."
        : summary.daysSinceLastSession === 1
          ? "Most recent: yesterday."
          : `Most recent: ${summary.daysSinceLastSession} days ago.`;
  const distanceClause =
    summary.totalDistanceKm > 0 ? `, ${summary.totalDistanceKm} km total` : "";
  return (
    `External training (from connected apps, last 30 days): ` +
    `${summary.count} session${summary.count === 1 ? "" : "s"}, ` +
    `${summary.totalActiveMin} active min${distanceClause}. ` +
    `Sources: ${sources}. ${recencyClause}`.trim()
  );
}
