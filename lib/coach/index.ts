/**
 * Conservative coach state machine.
 * Adapted from eranganot/adaptivefit server/coach.ts with two new rules:
 *   - Soft freeze when 7-day average foot_pain >= 4
 *   - Reduce continuous interval length on `breathing_dereg` or `form_breakdown`
 *
 * Pure functions — no DB calls. Caller (route handler) loads inputs from DB,
 * calls `evaluateCoach(...)`, then persists the result.
 */
import type { WorkoutLog, FeedbackSentiment, UserLevelState } from "@/lib/db/schema";

export type CoachInputs = {
  /** Last 14 days of workout logs, newest-first */
  recentLogs: Array<WorkoutLog & { sentiment?: FeedbackSentiment | null }>;
  /** Current FSM state for the user */
  state: Pick<UserLevelState, "currentLevel" | "greenSessionCount" | "freezeActive" | "freezeReason" | "manualOverride" | "manualOverrideUntil">;
  /** ISO date string for "today" — explicit so tests are deterministic */
  today: Date;
  /** Hint for the session being planned: "quality" (Tue) or "endurance" (Fri). Default: "quality" */
  sessionKind?: "quality" | "endurance";
};

export type SessionBlock =
  | { kind: "run_block"; distanceKm: number; paceSecPerKm: number; reps: number; recoverySec: number }
  | { kind: "warmup"; durationMin: number }
  | { kind: "mobility"; exercises: string[] }
  | { kind: "rest" };

export type SessionPlan = {
  title: string;
  blocks: SessionBlock[];
  rationale: string; // Human-readable "why" — surfaced in the debug panel
};

export type CoachResult = {
  newState: UserLevelState;
  todayPlan: SessionPlan;
  /** A short list of which rule(s) fired this evaluation, in order */
  rulesApplied: string[];
};

// Tunables — kept inline as constants so they're easy to read in code review.
export const TUNABLES = {
  /** Hard freeze threshold for any single session in last 7 days */
  PAIN_HARD_FREEZE: 7,
  /** Soft freeze if 7-day rolling average pain hits this */
  PAIN_SOFT_FREEZE_AVG: 4,
  /** Green session must have RPE <= and pain <= these */
  GREEN_MAX_RPE: 7,
  GREEN_MAX_PAIN: 3,
  /** Greens needed before the coach promotes a level */
  GREENS_FOR_PROMOTION: 3,
  /** Symptoms that trigger interval reduction */
  REDUCTION_SYMPTOMS: ["breathing_dereg", "form_breakdown"] as const,
  /** % to reduce continuous interval length when reduction triggers */
  INTERVAL_REDUCTION_PCT: 0.25,
};

// ───────────────────────────────────────────────────────────────────
// Evaluator — top-level orchestrator. First matching rule wins.
// ───────────────────────────────────────────────────────────────────
export function evaluateCoach(inputs: CoachInputs): CoachResult {
  const { recentLogs, state, today, sessionKind = "quality" } = inputs;
  const rulesApplied: string[] = [];

  // Rule 0: manual override — if user set a level manually and window is still open,
  // lock the level and skip all FSM promotions/demotions.
  const overrideActive =
    state.manualOverride &&
    state.manualOverrideUntil != null &&
    new Date(state.manualOverrideUntil) > today;
  if (overrideActive) {
    rulesApplied.push("manual_override_active");
    // Still plan a session at the locked level, but skip all FSM transitions
    const plan = buildSessionForLevel(state.currentLevel ?? 1, sessionKind, "Manual level lock — planning at your chosen level.");
    return makeResult(state, plan, rulesApplied, {});
  }

  // Rule 1: hard freeze on any pain >= 7 in last 7 days
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const hadHardPain = recentLogs.some(
    (l) => l.performedAt >= sevenDaysAgo && (l.footPain ?? 0) >= TUNABLES.PAIN_HARD_FREEZE,
  );
  if (hadHardPain) {
    rulesApplied.push("hard_freeze_pain_7plus");
    return makeResult(state, todayRest("Hard freeze: foot pain ≥ 7 in last 7 days. Recovery only."), rulesApplied, {
      freezeActive: true,
      freezeReason: "pain >= 7",
    });
  }

  // Rule 2: soft freeze on rolling 7-day pain avg >= 4
  const last7 = recentLogs.filter((l) => l.performedAt >= sevenDaysAgo);
  const avgPain = average(last7.map((l) => l.footPain ?? 0));
  if (last7.length > 0 && avgPain >= TUNABLES.PAIN_SOFT_FREEZE_AVG) {
    rulesApplied.push("soft_freeze_avg_pain_4plus");
    const lastRun = recentLogs.find((l) => l.type === "run");
    return makeResult(
      state,
      duplicateLastRun(lastRun, `Soft freeze: 7-day pain avg ${avgPain.toFixed(1)} ≥ 4. Same volume, no progression.`),
      rulesApplied,
      { freezeActive: false, greenSessionCount: 0 },
    );
  }

  // Rule 3: form-breakdown / breathing-dereg → reduce interval length
  const lastRun = recentLogs.find((l) => l.type === "run");
  const lastRunSymptoms = lastRun?.sentiment?.symptoms ?? [];
  const hasReductionSymptom = TUNABLES.REDUCTION_SYMPTOMS.some((s) =>
    (lastRunSymptoms as string[]).includes(s),
  );
  if (lastRun && hasReductionSymptom) {
    rulesApplied.push("interval_reduction_symptom");
    return makeResult(
      state,
      reduceIntervalLength(
        lastRun,
        `Reduced interval length 25% — last run flagged ${lastRunSymptoms.join(", ")}.`,
      ),
      rulesApplied,
      { greenSessionCount: 0 },
    );
  }

  // Rule 4: green session detection on most recent run
  let greens = state.greenSessionCount ?? 0;
  if (lastRun && isGreenSession(lastRun)) {
    greens += 1;
    rulesApplied.push("green_session");
  } else if (lastRun) {
    greens = 0; // reset
  }

  // Rule 5: promotion
  let level = state.currentLevel ?? 1;
  if (greens >= TUNABLES.GREENS_FOR_PROMOTION && level < 10) {
    level += 1;
    greens = 0;
    rulesApplied.push("promote_level");
    return makeResult(
      state,
      promotedSession(level, "Promoted! 3 green sessions in a row."),
      rulesApplied,
      { currentLevel: level, greenSessionCount: 0, freezeActive: false },
    );
  }

  // Rule 6: default — repeat last week's pattern
  rulesApplied.push("default_repeat");
  return makeResult(
    state,
    duplicateLastRun(lastRun, "Repeating last completed structure."),
    rulesApplied,
    { greenSessionCount: greens, freezeActive: false },
  );
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────
function isGreenSession(log: WorkoutLog): boolean {
  return (
    (log.rpe ?? 11) <= TUNABLES.GREEN_MAX_RPE &&
    (log.footPain ?? 11) <= TUNABLES.GREEN_MAX_PAIN
  );
}

function average(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function todayRest(rationale: string): SessionPlan {
  return {
    title: "Recovery Day",
    blocks: [
      { kind: "rest" },
      { kind: "mobility", exercises: ["Bird-Dog", "Plank", "Plantar Massage (ice bottle)"] },
    ],
    rationale,
  };
}

function duplicateLastRun(lastRun: WorkoutLog | undefined, rationale: string): SessionPlan {
  if (!lastRun) {
    return {
      title: "Easy Run — Onboarding",
      blocks: [
        { kind: "warmup", durationMin: 5 },
        { kind: "run_block", distanceKm: 1.5, paceSecPerKm: 420, reps: 2, recoverySec: 90 },
        { kind: "mobility", exercises: ["Bird-Dog", "Plank"] },
      ],
      rationale: "No recent runs found — starting conservative.",
    };
  }
  // Mirror the last run's distance/pace; keep reps if it was an interval session.
  const distanceKm = Number(lastRun.distanceKm ?? 1.5);
  const pace = lastRun.paceSecPerKm ?? 420;
  return {
    title: `${distanceKm.toFixed(1)} km @ ${formatPace(pace)} min/km`,
    blocks: [
      { kind: "warmup", durationMin: 5 },
      { kind: "run_block", distanceKm, paceSecPerKm: pace, reps: 1, recoverySec: 0 },
      { kind: "mobility", exercises: ["Bird-Dog", "Plank"] },
    ],
    rationale,
  };
}

function reduceIntervalLength(lastRun: WorkoutLog, rationale: string): SessionPlan {
  const baseDistance = Number(lastRun.distanceKm ?? 2);
  const reduced = Math.max(1, baseDistance * (1 - TUNABLES.INTERVAL_REDUCTION_PCT));
  const pace = lastRun.paceSecPerKm ?? 420;
  return {
    title: `3 × ${reduced.toFixed(1)} km blocks @ ${formatPace(pace)} min/km`,
    blocks: [
      { kind: "warmup", durationMin: 5 },
      { kind: "run_block", distanceKm: reduced, paceSecPerKm: pace, reps: 3, recoverySec: 120 },
      { kind: "mobility", exercises: ["Bird-Dog", "Plank", "Superman"] },
    ],
    rationale,
  };
}

function promotedSession(newLevel: number, rationale: string): SessionPlan {
  return buildSessionForLevel(newLevel, "quality", rationale);
}

/**
 * Build a session plan for a given level and kind.
 * quality (Tue) = shorter intervals with recovery
 * endurance (Fri) = longer continuous run
 */
export function buildSessionForLevel(
  level: number,
  kind: "quality" | "endurance",
  rationale: string,
): SessionPlan {
  const baseDistance = 1.5;
  const distance = Math.round((baseDistance * (1 + 0.2 * (level - 1))) * 10) / 10;
  // Pace improves slightly with level: starts at 7:30/km, improves 5s per level
  const paceSecPerKm = Math.max(360, 450 - (level - 1) * 5);

  if (kind === "endurance") {
    // Continuous run at comfortable pace — longer distance, no reps
    const enduranceDist = Math.round(distance * 1.5 * 10) / 10;
    const endurancePace = paceSecPerKm + 15; // slightly slower for endurance
    return {
      title: `${enduranceDist.toFixed(1)} km Easy Run`,
      blocks: [
        { kind: "warmup", durationMin: 5 },
        { kind: "run_block", distanceKm: enduranceDist, paceSecPerKm: endurancePace, reps: 1, recoverySec: 0 },
        { kind: "mobility", exercises: ["Bird-Dog", "Plank", "Plantar Massage (ice bottle)"] },
      ],
      rationale,
    };
  }

  // Quality session: intervals
  return {
    title: `Level ${level}: 3 × ${distance.toFixed(1)} km @ ${formatPace(paceSecPerKm)} /km`,
    blocks: [
      { kind: "warmup", durationMin: 6 },
      { kind: "run_block", distanceKm: distance, paceSecPerKm, reps: 3, recoverySec: 120 },
      { kind: "mobility", exercises: ["Bird-Dog", "Plank", "Superman", "Push-ups"] },
    ],
    rationale,
  };
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeResult(
  prev: CoachInputs["state"],
  todayPlan: SessionPlan,
  rulesApplied: string[],
  delta: Partial<UserLevelState>,
): CoachResult {
  const newState: UserLevelState = {
    userId: "" as unknown as string, // filled by caller
    currentLevel: prev.currentLevel,
    greenSessionCount: prev.greenSessionCount,
    freezeActive: prev.freezeActive ?? false,
    freezeReason: prev.freezeReason ?? null,
    lastEvaluatedAt: new Date(),
    manualOverride: prev.manualOverride ?? false,
    manualOverrideUntil: prev.manualOverrideUntil ?? null,
    ...delta,
  } as UserLevelState;
  return { newState, todayPlan, rulesApplied };
}
