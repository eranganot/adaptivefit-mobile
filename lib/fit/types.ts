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
  activeMinutes: number | null;       // null on Health Connect MVP — derived in Phase 8b
  avgHr: number | null;
  calories: number | null;
}
