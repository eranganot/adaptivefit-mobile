/**
 * lib/dates/week.ts
 *
 * Shared week-boundary helper for the roadmap / home / coach surfaces.
 *
 * Week anchor: **Sunday** (user preference — Israel work week starts Sunday).
 * This matches the analytics surface (lib/analytics/week.ts), which already
 * anchors on Sunday. Before this helper existed, roadmap/home/coach each
 * inlined a *Monday*-anchored calculation, so the roadmap's day-of-week math
 * disagreed with analytics. Centralising it here keeps the whole app on one
 * convention.
 *
 * dayIndex convention that pairs with this anchor: 0=Sun, 1=Mon, … 6=Sat.
 * A roadmap row's calendar date is therefore:
 *
 *     startOfWeekSunday(today) + (weekIndex * 7 + dayIndex) days
 *
 * NOTE: this uses the *local* timezone of the runtime (the Next.js server runs
 * in UTC on Railway, the browser/WebView runs in the user's tz). That matches
 * the previous inline behaviour exactly — we only changed the anchor day, not
 * the timezone handling — so no behaviour regressions beyond Mon→Sun.
 */

/**
 * Returns a new Date at local midnight on the Sunday that starts the week
 * containing `d`. Does not mutate the input.
 */
export function startOfWeekSunday(d: Date = new Date()): Date {
  const s = new Date(d);
  // getDay(): 0=Sun … 6=Sat. Subtracting it lands us on this week's Sunday.
  s.setDate(d.getDate() - d.getDay());
  s.setHours(0, 0, 0, 0);
  return s;
}

/**
 * Day index (0=Sun … 6=Sat) for a Date, in local time. Mirrors the dayIndex
 * stored on training_roadmap rows under the Sunday-anchored convention.
 */
export function sundayDayIndex(d: Date = new Date()): number {
  return d.getDay();
}
