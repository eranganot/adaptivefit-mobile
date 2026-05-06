/**
 * lib/analytics/week.ts
 *
 * Week utilities for analytics.
 * Week anchor : Sunday (day 0)
 * Timezone    : Asia/Jerusalem
 */

const IL_TZ = "Asia/Jerusalem";

const DOW_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Returns 0 (Sun) … 6 (Sat) for the given instant in Israel timezone. */
function ilDayOfWeek(date: Date): number {
  const shortDay = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    weekday: "short",
  }).format(date);
  return DOW_MAP[shortDay] ?? 0;
}

/**
 * Returns a Date at midnight UTC that corresponds to the Sunday
 * starting the week that contains `date` (in Israel timezone).
 */
export function sundayOfWeekIL(date: Date): Date {
  const dow = ilDayOfWeek(date);
  const sunday = new Date(date.getTime() - dow * 86_400_000);
  sunday.setUTCHours(0, 0, 0, 0);
  return sunday;
}

/**
 * Returns a "YYYY-MM-DD" string for the Sunday's date in Israel timezone.
 * Used as an exact map key to match SQL output.
 */
export function toILDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns a display label like "4 May" for the given Sunday start date.
 */
export function weekLabel(sundayStart: Date): string {
  return sundayStart.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: IL_TZ,
  });
}

/**
 * Returns the Sunday that is `n` weeks before `base`.
 * Pass n=0 to get `base` itself.
 */
export function sundayNWeeksAgo(base: Date, n: number): Date {
  return new Date(base.getTime() - n * 7 * 86_400_000);
}
