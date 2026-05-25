import { describe, expect, it } from "vitest";
import { evaluateCoach, TUNABLES } from "@/lib/coach";
import type { WorkoutLog, FeedbackSentiment } from "@/lib/db/schema";

// Helper to make a fake log; only fields the coach reads matter.
function log(overrides: Partial<WorkoutLog> & { symptoms?: string[] } = {}): WorkoutLog & {
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
    rpe: 6,
    footPain: 2,
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
        overallSentiment: "concern",
        symptoms: overrides.symptoms,
        severity: 5,
        aiSummaryEn: null,
        aiSummaryHe: null,
        geminiModel: "gemini-1.5-flash",
        createdAt: new Date(),
      }
    : null;
  return { ...merged, sentiment };
}

const baseState = {
  currentLevel: 1,
  greenSessionCount: 0,
  freezeActive: false,
  freezeReason: null,
  manualOverride: false,
  manualOverrideUntil: null,
};

describe("coach: hard freeze", () => {
  it("freezes when any session in last 7 days has pain >= 7", () => {
    const today = new Date("2026-04-27");
    const yesterday = new Date("2026-04-26");
    const result = evaluateCoach({
      recentLogs: [log({ performedAt: yesterday, footPain: 8 })],
      state: baseState,
      today,
    });
    expect(result.rulesApplied[0]).toBe("hard_freeze_pain_7plus");
    expect(result.todayPlan.title).toMatch(/Recovery/);
    expect(result.newState.freezeActive).toBe(true);
  });
});

describe("coach: soft freeze", () => {
  it("does NOT progress when 7d avg pain >= 4", () => {
    const today = new Date("2026-04-27");
    const recentLogs = [
      log({ performedAt: new Date("2026-04-26"), footPain: 5 }),
      log({ performedAt: new Date("2026-04-24"), footPain: 4 }),
      log({ performedAt: new Date("2026-04-22"), footPain: 4 }),
    ];
    const result = evaluateCoach({ recentLogs, state: baseState, today });
    expect(result.rulesApplied).toContain("soft_freeze_avg_pain_4plus");
    expect(result.newState.greenSessionCount).toBe(0);
  });
});

describe("coach: interval reduction", () => {
  it("reduces blocks by 25% on breathing_dereg", () => {
    const today = new Date("2026-04-27");
    const lastRun = log({
      performedAt: new Date("2026-04-26"),
      distanceKm: "2" as unknown as string,
      symptoms: ["breathing_dereg"],
      footPain: 3,
    });
    const result = evaluateCoach({ recentLogs: [lastRun], state: baseState, today });
    expect(result.rulesApplied).toContain("interval_reduction_symptom");
    // 2km × 0.75 = 1.5km — exactly Eran's recent decision
    expect(result.todayPlan.blocks.find((b) => b.kind === "run_block")).toMatchObject({
      kind: "run_block",
      distanceKm: 1.5,
      reps: 3,
    });
  });
});

describe("coach: greens + promotion", () => {
  it("counts a clean session as a green", () => {
    const today = new Date("2026-04-27");
    const cleanRun = log({ rpe: 6, footPain: 2 });
    const result = evaluateCoach({ recentLogs: [cleanRun], state: baseState, today });
    expect(result.rulesApplied).toContain("green_session");
    expect(result.newState.greenSessionCount).toBe(1);
  });

  it("promotes after 3 greens", () => {
    const today = new Date("2026-04-27");
    const cleanRun = log({ rpe: 6, footPain: 2 });
    const result = evaluateCoach({
      recentLogs: [cleanRun],
      state: { ...baseState, greenSessionCount: TUNABLES.GREENS_FOR_PROMOTION - 1 },
      today,
    });
    expect(result.rulesApplied).toContain("promote_level");
    expect(result.newState.currentLevel).toBe(2);
    expect(result.newState.greenSessionCount).toBe(0);
  });
});

describe("coach: default", () => {
  it("repeats last run when no rule matches and no greens accumulated", () => {
    const today = new Date("2026-04-27");
    const lastRun = log({ rpe: 8, footPain: 3 }); // RPE>7 disqualifies as green but no symptom
    const result = evaluateCoach({ recentLogs: [lastRun], state: baseState, today });
    expect(result.rulesApplied).toContain("default_repeat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// External activity (Tier 2 #3 — Strava/Samsung visibility)
// ─────────────────────────────────────────────────────────────────────────────
describe("coach: external activity data path", () => {
  const today = new Date("2026-04-27");

  it("records a rules_applied entry when external sessions are present", () => {
    const result = evaluateCoach({
      recentLogs: [log({ rpe: 6, footPain: 2 })],
      state: baseState,
      today,
      externalActivity: {
        count: 3,
        totalActiveMin: 90,
        totalDistanceKm: 12.5,
        lastSessionEndIso: "2026-04-26T10:00:00Z",
        daysSinceLastSession: 1,
        sourcesByApp: { "com.strava": 3 },
      },
    });
    const externalRule = result.rulesApplied.find((r) =>
      r.startsWith("external_activity_seen"),
    );
    expect(externalRule).toBeDefined();
    expect(externalRule).toContain("3"); // count
    expect(externalRule).toContain("lastDaysAgo=1");
  });

  it("does NOT add the rules_applied entry when count is 0", () => {
    const result = evaluateCoach({
      recentLogs: [log({ rpe: 6, footPain: 2 })],
      state: baseState,
      today,
      externalActivity: {
        count: 0,
        totalActiveMin: 0,
        totalDistanceKm: 0,
        lastSessionEndIso: null,
        daysSinceLastSession: null,
        sourcesByApp: {},
      },
    });
    expect(
      result.rulesApplied.some((r) => r.startsWith("external_activity_seen")),
    ).toBe(false);
  });

  it("does NOT change plan outcome — same plan with or without externalActivity", () => {
    // Critical invariant: external sessions are a visibility signal only.
    // Plan logic must remain identical so existing FSM tests stay valid and
    // so external sessions don't accidentally cause promotions/freezes (they
    // lack RPE/pain).
    const inputs = {
      recentLogs: [log({ rpe: 6, footPain: 2 })],
      state: baseState,
      today,
    };
    const without = evaluateCoach(inputs);
    const withExt = evaluateCoach({
      ...inputs,
      externalActivity: {
        count: 5,
        totalActiveMin: 180,
        totalDistanceKm: 30,
        lastSessionEndIso: "2026-04-26T10:00:00Z",
        daysSinceLastSession: 1,
        sourcesByApp: { "com.strava": 5 },
      },
    });
    // Plan must match exactly
    expect(withExt.todayPlan).toEqual(without.todayPlan);
    // State must match exactly
    expect(withExt.newState.currentLevel).toBe(without.newState.currentLevel);
    expect(withExt.newState.greenSessionCount).toBe(without.newState.greenSessionCount);
    expect(withExt.newState.freezeActive).toBe(without.newState.freezeActive);
    // rulesApplied differs only by the external_activity_seen entry
    const withoutExtRule = withExt.rulesApplied.filter(
      (r) => !r.startsWith("external_activity_seen"),
    );
    expect(withoutExtRule).toEqual(without.rulesApplied);
  });

  it("undefined externalActivity is the safe default — no rule entry, no errors", () => {
    const result = evaluateCoach({
      recentLogs: [log({ rpe: 6, footPain: 2 })],
      state: baseState,
      today,
      // externalActivity intentionally omitted
    });
    expect(
      result.rulesApplied.some((r) => r.startsWith("external_activity_seen")),
    ).toBe(false);
  });
});
