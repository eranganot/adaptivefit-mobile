/**
 * Per-day active-minutes derivation from ExerciseSession windows.
 *
 * Phase 8b polish #1 — Health Connect doesn't expose an "active minutes"
 * aggregate the way the legacy Google Fit REST API did. Instead, HC
 * surfaces ExerciseSession records with start/end timestamps. To populate
 * `fit_daily_metrics.active_minutes` we sum each session's duration into
 * the UTC day(s) it overlaps with, per the formula from
 * docs/PHASE_8B_HEALTH_CONNECT_FULL.md:
 *
 *   active_minutes_for_date(D) =
 *     sum( max(0, min(session.endTime, D+1) - max(session.startTime, D)) )
 *     for all sessions overlapping D
 *     divided by 60
 *
 * Sessions spanning midnight are split — minutes before midnight go to
 * day D, minutes after to D+1. Overlapping sessions are summed naively
 * (no clock-time dedup) per the spec; the rare double-booked-active-time
 * case isn't worth the complexity to model precisely.
 *
 * Pure function for easy testing — no DB, no plugin, no I/O.
 */

export type SessionWindow = {
  /** ISO 8601 string or Date. We normalize internally. */
  startTime: string | Date;
  endTime: string | Date;
};

/** YYYY-MM-DD (UTC). */
export type DateKey = string;

/** Format a Date as YYYY-MM-DD using the UTC calendar day. */
function utcDayKey(d: Date): DateKey {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** First moment of the UTC day containing `d`. */
function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** First moment of the UTC day AFTER the one containing `d`. */
function startOfNextUtcDay(d: Date): Date {
  const x = startOfUtcDay(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

/**
 * Walk each session, splitting its window across every UTC day it touches.
 * Returns a Map keyed by YYYY-MM-DD (UTC) with active minutes (rounded to
 * the nearest minute) for each day that has at least one second of active
 * time.
 *
 * Sessions with invalid windows (end <= start, unparseable timestamps) are
 * silently skipped — same as the readSessions path treats them.
 */
export function deriveActiveMinutesByDay(
  sessions: SessionWindow[],
): Map<DateKey, number> {
  // Accumulate seconds per day, convert to minutes at the end so rounding
  // happens once per day instead of per session.
  const secsByDay = new Map<DateKey, number>();

  for (const s of sessions) {
    const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const end = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;

    // Walk day-by-day from the UTC day containing `start` to the day
    // containing `end`. For each day, attribute the overlap with [start, end].
    let cursor = startOfUtcDay(start);
    while (cursor < end) {
      const nextDay = startOfNextUtcDay(cursor);
      const overlapStart = start > cursor ? start : cursor;
      const overlapEnd = end < nextDay ? end : nextDay;
      const overlapSec = Math.max(
        0,
        (overlapEnd.getTime() - overlapStart.getTime()) / 1000,
      );
      if (overlapSec > 0) {
        const key = utcDayKey(cursor);
        secsByDay.set(key, (secsByDay.get(key) ?? 0) + overlapSec);
      }
      cursor = nextDay;
    }
  }

  // Convert accumulated seconds to whole minutes per day, dropping days that
  // round to 0 (a sub-30s residual would round to 0 min and isn't worth a row).
  const minutesByDay = new Map<DateKey, number>();
  for (const [date, secs] of secsByDay) {
    const mins = Math.round(secs / 60);
    if (mins > 0) minutesByDay.set(date, mins);
  }
  return minutesByDay;
}
