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
// FitSession is not imported because we deliberately use a permissive
// SessionInput type below — `startTime`/`endTime` accept either Date OR
// ISO string at the input boundary (the runtime normalizes both). Tying
// the signature to Drizzle's FitSession (Date-only) made the test helpers
// uncompilable for no runtime benefit. Production callers (server actions
// querying via Drizzle) still get Date objects; tests can pass either.

/**
 * Input shape for the external-activity helpers. Intentionally narrower
 * than FitSession (only the fields these helpers actually read) and
 * permissive on the date fields. The internal normalizers handle either
 * shape safely.
 */
export type SessionInput = {
  startTime: Date | string;
  endTime: Date | string;
  distanceM: number | null;
  sourceApp: string | null;
};

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
  sessions: SessionInput[],
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
    const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const end = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
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

/**
 * Categorize a session as likely training vs likely casual activity.
 *
 * Heuristic only — HC doesn't expose user intent. Bias: prefer false
 * "activity" (under-claim training) over false "training" (over-claim).
 * The coach is allowed to ask the user to clarify if it's ambiguous.
 *
 * Rules:
 *   - Sessions ≥ 30 min OR ≥ 3 km of distance → "training"
 *   - Otherwise → "activity" (e.g., a short walk to the cafe)
 *
 * The threshold is intentionally generous on the training side: a 28-min
 * easy 4km run is training; a 15-min stroll is activity. If the user
 * pushes back ("that 2km walk WAS my recovery session"), they can log
 * an AF workout for it and the chat coach will see the AF log next time.
 */
function classifySession(durationSec: number, distanceM: number | null): "training" | "activity" {
  const minutes = durationSec / 60;
  const km = distanceM != null && distanceM > 0 ? distanceM / 1000 : 0;
  if (minutes >= 30 || km >= 3) return "training";
  return "activity";
}

/** Format a session start as "today HH:MM" / "yesterday HH:MM" / "Mon 14 Apr HH:MM"
 *  in Asia/Jerusalem time, so the coach can be unambiguous about timing. */
function formatSessionStart(start: Date, now: Date): string {
  const tz = "Asia/Jerusalem";
  const dayDiff = Math.floor(
    (now.setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / 86400000,
  );
  const time = new Date(start).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `yesterday ${time}`;
  const date = new Date(start).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
  return `${date} ${time}`;
}

/** Build a per-session line for the prompt context. Includes type label,
 *  duration, distance (if any), source app, and the training/activity
 *  classification so the chat coach can use precise terminology. */
export function formatRecentSessionsForPrompt(
  sessions: SessionInput[],
  now: Date = new Date(),
  limit: number = 3,
): string[] {
  const sorted = [...sessions]
    .filter((s) => {
      const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
      const end = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
      return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start;
    })
    .sort((a, b) => {
      const aEnd = a.endTime instanceof Date ? a.endTime : new Date(a.endTime);
      const bEnd = b.endTime instanceof Date ? b.endTime : new Date(b.endTime);
      return bEnd.getTime() - aEnd.getTime();
    })
    .slice(0, limit);

  return sorted.map((s) => {
    const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const end = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
    const durationSec = (end.getTime() - start.getTime()) / 1000;
    const durationMin = Math.round(durationSec / 60);
    const km = s.distanceM != null && s.distanceM > 0 ? s.distanceM / 1000 : null;
    const classification = classifySession(durationSec, s.distanceM ?? null);
    const sourceLabel = SOURCE_APP_LABELS[s.sourceApp ?? "unknown"] ?? s.sourceApp ?? "unknown";
    const distancePart = km != null ? `, ${km.toFixed(2)} km` : "";
    return `${formatSessionStart(start, new Date(now))} — ${durationMin} min${distancePart} (${sourceLabel}, likely ${classification})`;
  });
}

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
    `External sessions seen (from connected apps, last 30 days): ` +
    `${summary.count} session${summary.count === 1 ? "" : "s"}, ` +
    `${summary.totalActiveMin} active min${distanceClause}. ` +
    `Sources: ${sources}. ${recencyClause}`.trim()
  );
}
