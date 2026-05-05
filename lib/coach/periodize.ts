/**
 * Periodization helper — 3-week build / 1-week deload cycle.
 *
 * Given the current week index in the planning window and the user's active
 * goal target date, returns the training phase and a volume multiplier that
 * the session builder applies to adjust distance / sets.
 *
 * Phases:
 *   build   — normal load progression (×1.0 → ×1.1 → ×1.2 per week in the cycle)
 *   deload  — every 4th week: volume drops to ×0.7 to absorb adaptation
 *   peak    — 3 weeks before target: highest stimulus (×1.25)
 *   taper   — final 2 weeks before target: back off to ×0.75 for race freshness
 *
 * If targetDate is null, the cycle is driven purely by weekIndex % 4.
 */

export type TrainingPhase = "build" | "deload" | "peak" | "taper";

export interface PeriodizeResult {
  phase: TrainingPhase;
  /** Multiply base distance / volume by this factor */
  volumeMultiplier: number;
  /** 0 = no level bump, +1 = plan one tier up, -1 = plan one tier down */
  levelOffset: number;
}

export function periodize({
  weekIndex,
  targetDate,
}: {
  weekIndex: number;       // 0-based index of the session week (0 = this week)
  targetDate: Date | null; // active goal's target date, or null
}): PeriodizeResult {
  // If we have a target date, compute weeks remaining
  if (targetDate) {
    const now = new Date();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const totalWeeksLeft = Math.max(0, Math.ceil((targetDate.getTime() - now.getTime()) / msPerWeek));
    const weeksFromNow = totalWeeksLeft - weekIndex; // weeks until target from this session's week

    if (weeksFromNow <= 0) {
      // Past target date — continue training normally
      return { phase: "build", volumeMultiplier: 1.0, levelOffset: 0 };
    }
    if (weeksFromNow <= 2) {
      return { phase: "taper", volumeMultiplier: 0.75, levelOffset: -1 };
    }
    if (weeksFromNow <= 3) {
      return { phase: "peak", volumeMultiplier: 1.25, levelOffset: 1 };
    }
  }

  // 3-build / 1-deload cycle, anchored from the start of the program
  const cyclePosition = weekIndex % 4;
  switch (cyclePosition) {
    case 0: return { phase: "build", volumeMultiplier: 1.0,  levelOffset: 0 };
    case 1: return { phase: "build", volumeMultiplier: 1.1,  levelOffset: 0 };
    case 2: return { phase: "build", volumeMultiplier: 1.2,  levelOffset: 0 };
    case 3: return { phase: "deload", volumeMultiplier: 0.7, levelOffset: -1 };
    default: return { phase: "build", volumeMultiplier: 1.0, levelOffset: 0 };
  }
}
