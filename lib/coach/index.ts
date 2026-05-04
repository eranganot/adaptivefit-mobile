/**
 * Conservative coach state machine.
 * Adapted from eranganot/adaptivefit server/coach.ts with additions:
 *   - Soft freeze when 7-day average foot_pain >= 4
 *   - Reduce continuous interval length on `breathing_dereg` or `form_breakdown`
 *   - Goal-category branching: strength / weight_loss / body_shape / running
 *   - Manual override (Bug #9): locks level for 7 days
 *
 * Pure functions — no DB calls. Caller loads inputs from DB, calls evaluateCoach,
 * then persists the result.
 */
import type { WorkoutLog, FeedbackSentiment, UserLevelState } from "@/lib/db/schema";

export type GoalCategory = "running" | "body_shape" | "weight_loss" | "strength";

export type CoachInputs = {
  /** Last 14 days of workout logs, newest-first */
  recentLogs: Array<WorkoutLog & { sentiment?: FeedbackSentiment | null }>;
  /** Current FSM state for the user */
  state: Pick<
    UserLevelState,
    | "currentLevel"
    | "greenSessionCount"
    | "freezeActive"
    | "freezeReason"
    | "manualOverride"
    | "manualOverrideUntil"
  >;
  /** ISO date string for "today" — explicit so tests are deterministic */
  today: Date;
  /** Hint for the session being planned: "quality" (Tue) or "endurance" (Fri). Default: "quality" */
  sessionKind?: "quality" | "endurance";
  /** Active goal category — drives session plan type. Default: "running" */
  goalCategory?: GoalCategory;
};

export type SessionBlock =
  | { kind: "run_block"; distanceKm: number; paceSecPerKm: number; reps: number; recoverySec: number }
  | { kind: "warmup"; durationMin: number }
  | { kind: "mobility"; exercises: string[] }
  | { kind: "rest" }
  | {
      kind: "strength_block";
      exercises: Array<{ name: string; sets: number; reps: number; rpeTarget: number }>;
    };

export type SessionPlan = {
  title: string;
  blocks: SessionBlock[];
  rationale: string;
};

export type CoachResult = {
  newState: UserLevelState;
  todayPlan: SessionPlan;
  /** A short list of which rule(s) fired this evaluation, in order */
  rulesApplied: string[];
};

// Tunables
export const TUNABLES = {
  PAIN_HARD_FREEZE: 7,
  PAIN_SOFT_FREEZE_AVG: 4,
  GREEN_MAX_RPE: 7,
  GREEN_MAX_PAIN: 3,
  GREENS_FOR_PROMOTION: 3,
  REDUCTION_SYMPTOMS: ["breathing_dereg", "form_breakdown"] as const,
  INTERVAL_REDUCTION_PCT: 0.25,
  // Strength-specific
  STRENGTH_OVERLOAD_RPE: 9,    // hard freeze if RPE >= this
  STRENGTH_SOFT_RPE: 8,        // soft freeze if avg RPE >= this for last 3 sessions
  STRENGTH_GREEN_MIN_RPE: 5,
  STRENGTH_GREEN_MAX_RPE: 8,
};

// ─────────────────────────────────────────────────────────────────────────────
// Top-level dispatcher
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateCoach(inputs: CoachInputs): CoachResult {
  const { state, today, sessionKind = "quality", goalCategory = "running" } = inputs;
  const rulesApplied: string[] = [];

  // Rule 0 (all categories): manual override — lock level for 7-day window
  const overrideActive =
    state.manualOverride &&
    state.manualOverrideUntil != null &&
    new Date(state.manualOverrideUntil) > today;

  if (overrideActive) {
    rulesApplied.push("manual_override_active");
    const plan =
      goalCategory === "strength"
        ? buildStrengthSession(state.currentLevel ?? 1, sessionKind, "Manual level lock — planning at your chosen level.")
        : buildSessionForLevel(state.currentLevel ?? 1, sessionKind, "Manual level lock — planning at your chosen level.");
    return makeResult(state, plan, rulesApplied, {});
  }

  if (goalCategory === "strength") {
    return evaluateStrengthCoach(inputs, rulesApplied);
  }

  // weight_loss and body_shape use the running FSM with lower target RPE framing
  return evaluateRunningCoach(inputs, rulesApplied);
}

// ─────────────────────────────────────────────────────────────────────────────
// Running coach (also used for weight_loss and body_shape)
// ─────────────────────────────────────────────────────────────────────────────
function evaluateRunningCoach(inputs: CoachInputs, rulesApplied: string[]): CoachResult {
  const { recentLogs, state, today, sessionKind = "quality", goalCategory = "running" } = inputs;

  // Rule 1: hard freeze on foot pain >= 7 in last 7 days
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const hadHardPain = recentLogs.some(
    (l) => l.performedAt >= sevenDaysAgo && (l.footPain ?? 0) >= TUNABLES.PAIN_HARD_FREEZE,
  );
  if (hadHardPain) {
    rulesApplied.push("hard_freeze_pain_7plus");
    return makeResult(
      state,
      todayRest("Hard freeze: foot pain ≥ 7 in last 7 days. Recovery only."),
      rulesApplied,
      { freezeActive: true, freezeReason: "pain >= 7" },
    );
  }

  // Rule 2: soft freeze on rolling 7-day pain avg >= 4
  const last7 = recentLogs.filter((l) => l.performedAt >= sevenDaysAgo);
  const avgPain = average(last7.map((l) => l.footPain ?? 0));
  if (last7.length > 0 && avgPain >= TUNABLES.PAIN_SOFT_FREEZE_AVG) {
    rulesApplied.push("soft_freeze_avg_pain_4plus");
    const lastRun = recentLogs.find((l) => l.type === "run");
    return makeResult(
      state,
      duplicateLastRun(
        lastRun,
        `Soft freeze: 7-day pain avg ${avgPain.toFixed(1)} ≥ 4. Same volume, no progression.`,
      ),
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
    greens = 0;
  }

  // Rule 5: promotion
  let level = state.currentLevel ?? 1;
  if (greens >= TUNABLES.GREENS_FOR_PROMOTION && level < 10) {
    level += 1;
    greens = 0;
    rulesApplied.push("promote_level");
    const rationale =
      goalCategory === "weight_loss"
        ? "Great consistency! Adding a little more cardio this session."
        : goalCategory === "body_shape"
          ? "Steady progress — bumping up training load slightly."
          : "Promoted! 3 green sessions in a row.";
    return makeResult(state, promotedSession(level, rationale), rulesApplied, {
      currentLevel: level,
      greenSessionCount: 0,
      freezeActive: false,
    });
  }

  // Rule 6: default — plan session at current level
  rulesApplied.push("default_repeat");
  const rationale =
    goalCategory === "weight_loss"
      ? "Steady cardio session — keep heart rate in fat-burning zone (RPE 5-6)."
      : goalCategory === "body_shape"
        ? "Balanced session — mix of cardio and bodyweight work."
        : "Repeating last completed structure.";
  return makeResult(state, buildSessionForLevel(level, sessionKind, rationale), rulesApplied, {
    greenSessionCount: greens,
    freezeActive: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Strength coach
// ─────────────────────────────────────────────────────────────────────────────
function evaluateStrengthCoach(inputs: CoachInputs, rulesApplied: string[]): CoachResult {
  const { recentLogs, state, today, sessionKind = "quality" } = inputs;

  // Rule S1: hard freeze if last session RPE >= 9 (overtraining risk)
  const lastWorkout = recentLogs[0];
  if (lastWorkout && (lastWorkout.rpe ?? 0) >= TUNABLES.STRENGTH_OVERLOAD_RPE) {
    rulesApplied.push("strength_hard_freeze_rpe9");
    return makeResult(
      state,
      strengthRestDay("Hard reset: last session RPE ≥ 9. Full rest + mobility today."),
      rulesApplied,
      { freezeActive: true, freezeReason: "strength RPE >= 9" },
    );
  }

  // Rule S2: foot pain still matters (plantar fascia affects strength training stance)
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const hadHardPain = recentLogs.some(
    (l) => l.performedAt >= sevenDaysAgo && (l.footPain ?? 0) >= TUNABLES.PAIN_HARD_FREEZE,
  );
  if (hadHardPain) {
    rulesApplied.push("strength_freeze_foot_pain");
    return makeResult(
      state,
      strengthRestDay("Foot pain too high for loaded compound lifts. Upper-body + mobility only."),
      rulesApplied,
      { freezeActive: true, freezeReason: "foot pain >= 7" },
    );
  }

  // Rule S3: soft freeze if avg RPE >= 8 over last 3 sessions
  const last3 = recentLogs.slice(0, 3);
  const avgRpe = average(last3.map((l) => l.rpe ?? 0));
  if (last3.length >= 3 && avgRpe >= TUNABLES.STRENGTH_SOFT_RPE) {
    rulesApplied.push("strength_soft_freeze_avg_rpe8");
    return makeResult(
      state,
      buildStrengthSession(
        state.currentLevel ?? 1,
        sessionKind,
        `High average RPE (${avgRpe.toFixed(1)}/10) — deload week. Same exercises, 60% of normal volume.`,
        true, // deload
      ),
      rulesApplied,
      { freezeActive: false, greenSessionCount: 0 },
    );
  }

  // Rule S4: green session tracking
  let greens = state.greenSessionCount ?? 0;
  const isGreen =
    lastWorkout &&
    (lastWorkout.rpe ?? 0) >= TUNABLES.STRENGTH_GREEN_MIN_RPE &&
    (lastWorkout.rpe ?? 0) <= TUNABLES.STRENGTH_GREEN_MAX_RPE &&
    (lastWorkout.footPain ?? 0) <= TUNABLES.GREEN_MAX_PAIN;

  if (isGreen) {
    greens += 1;
    rulesApplied.push("strength_green_session");
  } else if (lastWorkout) {
    greens = 0;
  }

  // Rule S5: promotion → add a set or bump RPE target
  let level = state.currentLevel ?? 1;
  if (greens >= TUNABLES.GREENS_FOR_PROMOTION && level < 10) {
    level += 1;
    greens = 0;
    rulesApplied.push("strength_promote_level");
    return makeResult(
      state,
      buildStrengthSession(level, sessionKind, "Progression! Adding volume — you've earned it."),
      rulesApplied,
      { currentLevel: level, greenSessionCount: 0, freezeActive: false },
    );
  }

  // Rule S6: default — plan at current level
  rulesApplied.push("strength_default");
  return makeResult(
    state,
    buildStrengthSession(level, sessionKind, "Consistent strength session — focus on form."),
    rulesApplied,
    { greenSessionCount: greens, freezeActive: false },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session builders — Running
// ─────────────────────────────────────────────────────────────────────────────
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
 * Build a running session plan for a given level and kind.
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
  const paceSecPerKm = Math.max(360, 450 - (level - 1) * 5);

  if (kind === "endurance") {
    const enduranceDist = Math.round(distance * 1.5 * 10) / 10;
    const endurancePace = paceSecPerKm + 15;
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

// ─────────────────────────────────────────────────────────────────────────────
// Session builders — Strength
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strength session scaled by level.
 * quality (Tue/day1) = Push day: bench + shoulder press + triceps
 * endurance (Fri/day2) = Pull+Legs: deadlift + squat + rows
 *
 * Level 1-2:  3×10, RPE 6   (form focus)
 * Level 3-4:  3×8,  RPE 7
 * Level 5-6:  4×6,  RPE 7-8
 * Level 7-8:  5×5,  RPE 8
 * Level 9-10: 5×3,  RPE 9   (heavy compound)
 */
export function buildStrengthSession(
  level: number,
  kind: "quality" | "endurance",
  rationale: string,
  deload = false,
): SessionPlan {
  type ExerciseSpec = { name: string; sets: number; reps: number; rpeTarget: number };

  // Determine sets/reps/RPE by level tier
  let sets: number, reps: number, rpeTarget: number;
  if (level <= 2)      { sets = 3; reps = 10; rpeTarget = 6; }
  else if (level <= 4) { sets = 3; reps = 8;  rpeTarget = 7; }
  else if (level <= 6) { sets = 4; reps = 6;  rpeTarget = 7; }
  else if (level <= 8) { sets = 5; reps = 5;  rpeTarget = 8; }
  else                 { sets = 5; reps = 3;  rpeTarget = 9; }

  if (deload) { sets = Math.max(2, sets - 1); rpeTarget = Math.max(5, rpeTarget - 2); }

  const pushExercises: ExerciseSpec[] = [
    { name: "Bench Press", sets, reps, rpeTarget },
    { name: "Overhead Press", sets: Math.max(2, sets - 1), reps, rpeTarget: rpeTarget - 1 },
    { name: "Tricep Dips", sets: 3, reps: 10, rpeTarget: 6 },
  ];

  const pullLegsExercises: ExerciseSpec[] = [
    { name: "Deadlift", sets, reps, rpeTarget },
    { name: "Squat", sets, reps, rpeTarget: rpeTarget - 1 },
    { name: "Barbell Row", sets: Math.max(2, sets - 1), reps, rpeTarget: rpeTarget - 1 },
  ];

  const exercises = kind === "quality" ? pushExercises : pullLegsExercises;
  const sessionName = kind === "quality" ? "Push Day" : "Pull + Legs Day";

  return {
    title: `Level ${level}: ${sessionName} — ${sets}×${reps}`,
    blocks: [
      { kind: "warmup", durationMin: 8 },
      { kind: "strength_block", exercises },
      { kind: "mobility", exercises: ["Hip Flexor Stretch", "Shoulder Rolls", "Foam Roll Quads"] },
    ],
    rationale,
  };
}

function strengthRestDay(rationale: string): SessionPlan {
  return {
    title: "Rest + Mobility",
    blocks: [
      { kind: "rest" },
      { kind: "mobility", exercises: ["Hip Flexor Stretch", "Shoulder Circles", "Cat-Cow", "Foam Roll"] },
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
    userId: "" as unknown as string,
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
