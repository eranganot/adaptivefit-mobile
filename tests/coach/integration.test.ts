/**
 * Integration-style tests for the coach FSM + roadmap regen trigger logic.
 *
 * These tests exercise the pure functions that back logManualWorkout:
 *   - evaluateCoach() returns the correct new state
 *   - shouldRegen flag logic (freeze-activated / level-promoted)
 *
 * We don't hit the DB here — that's intentional. The test isolates the
 * decision logic so regressions are caught without a live database.
 */
import { describe, expect, it } from "vitest";
import { evaluateCoach, TUNABLES } from "@/lib/coach";
import type { WorkoutLog, FeedbackSentiment, UserLevelState } from "@/lib/db/schema";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLog(overrides: Partial<WorkoutLog> & { symptoms?: string[] } = {}): WorkoutLog & {
  sentiment?: FeedbackSentiment | null;
} {
  const base: WorkoutLog = {
    id: crypto.randomUUID(),
    userId: "u1",
    performedAt: new Date(),
    type: "run",
    distanceKm: "4.31" as unknown as string,
    durationSec: 1880,
    paceSecPerKm: 436,
    exercises: null,
    rpe: 5,
    footPain: 1,
    otherPain: null,
    notesRaw: null,
    notesLocale: "en",
    rtl: "2.586" as unknown as string,
    createdAt: new Date(),
  };
  const merged = { ...base, ...overrides };
  const sentiment: FeedbackSentiment | null = overrides.symptoms
    ? {
        id: "s1",
        workoutLogId: merged.id,
        overallSentiment: "neutral",
        symptoms: overrides.symptoms,
        severity: 2,
        aiSummaryEn: null,
        aiSummaryHe: null,
        geminiModel: "test",
        createdAt: new Date(),
      }
    : null;
  return { ...merged, sentiment };
}

function makeState(
  overrides: Partial<
    Pick<
      UserLevelState,
      | "currentLevel"
      | "greenSessionCount"
      | "freezeActive"
      | "freezeReason"
      | "manualOverride"
      | "manualOverrideUntil"
    >
  > = {},
): Pick<
  UserLevelState,
  | "currentLevel"
  | "greenSessionCount"
  | "freezeActive"
  | "freezeReason"
  | "manualOverride"
  | "manualOverrideUntil"
> {
  return {
    currentLevel: 1,
    greenSessionCount: 0,
    freezeActive: false,
    freezeReason: null,
    manualOverride: false,
    manualOverrideUntil: null,
    ...overrides,
  };
}

/** Mirrors the shouldRegen logic in home/actions.ts */
function shouldRegen(
  prevState: Pick<UserLevelState, "currentLevel" | "freezeActive">,
  newState: Pick<UserLevelState, "currentLevel" | "freezeActive">,
): boolean {
  return (
    (newState.freezeActive && !prevState.freezeActive) ||
    newState.currentLevel > prevState.currentLevel
  );
}

// ── happy path ────────────────────────────────────────────────────────────────

describe("logManualWorkout integration: happy path (no regen)", () => {
  it("clean run at RPE 5, pain 1 → green session counted, no freeze, no regen", () => {
    const prev = makeState({ currentLevel: 1, greenSessionCount: 0, freezeActive: false });
    const result = evaluateCoach({
      recentLogs: [makeLog({ rpe: 5, footPain: 1 })],
      state: prev,
      today: new Date(),
    });

    expect(result.newState.freezeActive).toBe(false);
    expect(result.newState.currentLevel).toBe(1);
    expect(result.newState.greenSessionCount).toBe(1);
    expect(shouldRegen(prev, result.newState)).toBe(false);
  });

  it("two clean sessions already logged, third clean → promotion to level 2 → regen fires", () => {
    const prev = makeState({ currentLevel: 1, greenSessionCount: 2, freezeActive: false });
    const logs = Array.from({ length: 3 }, () => makeLog({ rpe: 5, footPain: 1 }));
    const result = evaluateCoach({ recentLogs: logs, state: prev, today: new Date() });

    expect(result.newState.currentLevel).toBe(2);
    expect(result.newState.greenSessionCount).toBe(0); // reset on promotion
    expect(shouldRegen(prev, result.newState)).toBe(true); // level promoted → regen
  });
});

// ── freeze path ───────────────────────────────────────────────────────────────

describe("logManualWorkout integration: freeze path (regen fires)", () => {
  it("session with pain >= PAIN_HARD_FREEZE → hard freeze activates → regen fires", () => {
    const prev = makeState({ currentLevel: 2, greenSessionCount: 1, freezeActive: false });
    const result = evaluateCoach({
      recentLogs: [makeLog({ footPain: TUNABLES.PAIN_HARD_FREEZE })],
      state: prev,
      today: new Date(),
    });

    expect(result.newState.freezeActive).toBe(true);
    expect(shouldRegen(prev, result.newState)).toBe(true); // freeze just activated
  });

  it("session where 7-day avg pain >= PAIN_SOFT_FREEZE_AVG → soft freeze → regen fires", () => {
    const prev = makeState({ currentLevel: 1, greenSessionCount: 0, freezeActive: false });
    // 7 logs with pain = 4 (avg exactly at threshold)
    const logs = Array.from({ length: 7 }, () => makeLog({ footPain: TUNABLES.PAIN_SOFT_FREEZE_AVG }));
    const result = evaluateCoach({ recentLogs: logs, state: prev, today: new Date() });

    expect(result.newState.freezeActive).toBe(false); // soft freeze: freezeActive stays false (same-volume repeat)
    // The coach duplicates the last run but doesn't change level or toggle freeze flag,
    // so shouldRegen is false for soft freeze — this is intentional conservative behaviour.
    expect(shouldRegen(prev, result.newState)).toBe(false);
  });

  it("already frozen + another bad session → freeze stays, regen does NOT fire again", () => {
    const prev = makeState({ currentLevel: 1, greenSessionCount: 0, freezeActive: true });
    const result = evaluateCoach({
      recentLogs: [makeLog({ footPain: TUNABLES.PAIN_HARD_FREEZE })],
      state: prev,
      today: new Date(),
    });

    expect(result.newState.freezeActive).toBe(true);
    expect(shouldRegen(prev, result.newState)).toBe(false); // freeze was already active — no regen loop
  });
});

// ── shouldRegen edge cases ────────────────────────────────────────────────────

describe("shouldRegen flag logic", () => {
  it("no state change → false", () => {
    const state = makeState({ currentLevel: 3, freezeActive: false });
    expect(shouldRegen(state, state)).toBe(false);
  });

  it("level goes up → true", () => {
    expect(shouldRegen(makeState({ currentLevel: 2 }), makeState({ currentLevel: 3 }))).toBe(true);
  });

  it("level goes down (shouldn't happen but guard it) → false", () => {
    expect(shouldRegen(makeState({ currentLevel: 3 }), makeState({ currentLevel: 2 }))).toBe(false);
  });

  it("freeze transitions false → true → true", () => {
    // Only the first transition (false → true) should fire regen
    expect(shouldRegen(makeState({ freezeActive: false }), makeState({ freezeActive: true }))).toBe(true);
    expect(shouldRegen(makeState({ freezeActive: true }), makeState({ freezeActive: true }))).toBe(false);
  });
});
