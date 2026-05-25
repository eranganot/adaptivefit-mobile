/**
 * Active-minutes derivation tests (Phase 8b polish #1).
 *
 * Pins the contract of deriveActiveMinutesByDay across:
 *   - Simple single-day sessions
 *   - Sessions spanning midnight UTC (split correctly)
 *   - Multi-day sessions (rare but real — e.g. an ultra)
 *   - Overlapping sessions on the same day (summed naively per spec)
 *   - Invalid / zero-duration sessions (silently skipped)
 *   - Empty input
 *
 * The whole point of this helper is to keep the math correct in the face
 * of midnight rollover — that's where a hand-rolled "session.duration"
 * approach silently gets the wrong answer (a 23:30-00:30 run gets
 * attributed entirely to the start day instead of being split).
 */
import { describe, expect, it } from "vitest";
import { deriveActiveMinutesByDay } from "@/lib/fit/deriveActiveMinutes";

/** Helper — build a Date from a UTC ISO timestamp. */
function utc(iso: string): Date {
  return new Date(iso);
}

describe("deriveActiveMinutesByDay", () => {
  it("empty input → empty map", () => {
    expect(deriveActiveMinutesByDay([]).size).toBe(0);
  });

  it("single 45-minute session on one UTC day → 45 minutes on that day", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T10:45:00Z") },
    ]);
    expect(r.size).toBe(1);
    expect(r.get("2026-05-20")).toBe(45);
  });

  it("accepts ISO strings as well as Date objects", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: "2026-05-20T10:00:00Z", endTime: "2026-05-20T10:30:00Z" },
    ]);
    expect(r.get("2026-05-20")).toBe(30);
  });

  it("two sessions on same UTC day → sum", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T08:00:00Z"), endTime: utc("2026-05-20T08:30:00Z") },
      { startTime: utc("2026-05-20T18:00:00Z"), endTime: utc("2026-05-20T19:00:00Z") },
    ]);
    expect(r.size).toBe(1);
    expect(r.get("2026-05-20")).toBe(30 + 60);
  });

  it("session spanning midnight UTC → split across both days", () => {
    // 23:30 to 00:30 = 60 minutes total. 30 to one day, 30 to the next.
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T23:30:00Z"), endTime: utc("2026-05-21T00:30:00Z") },
    ]);
    expect(r.size).toBe(2);
    expect(r.get("2026-05-20")).toBe(30);
    expect(r.get("2026-05-21")).toBe(30);
  });

  it("multi-day session (>24h) → minutes attributed to every covered day", () => {
    // Hypothetical ultra: 2026-05-19 18:00 → 2026-05-21 06:00 = 36h.
    // Day 19 gets the 6h tail (18:00-24:00 = 360 min)
    // Day 20 gets the full 24h (1440 min)
    // Day 21 gets the 6h head (00:00-06:00 = 360 min)
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-19T18:00:00Z"), endTime: utc("2026-05-21T06:00:00Z") },
    ]);
    expect(r.size).toBe(3);
    expect(r.get("2026-05-19")).toBe(360);
    expect(r.get("2026-05-20")).toBe(1440);
    expect(r.get("2026-05-21")).toBe(360);
  });

  it("overlapping sessions on same day → summed naively (spec)", () => {
    // 10:00-11:00 (60 min) + 10:30-11:30 (60 min). Real wall-clock active
    // time = 90 min, but the spec says sum durations — we get 120.
    // Documenting the spec-conformant behavior; if this ever becomes a
    // real complaint, switch to interval-merging.
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T11:00:00Z") },
      { startTime: utc("2026-05-20T10:30:00Z"), endTime: utc("2026-05-20T11:30:00Z") },
    ]);
    expect(r.get("2026-05-20")).toBe(120);
  });

  it("invalid window (end <= start) → skipped", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T10:00:00Z") },
      { startTime: utc("2026-05-20T11:00:00Z"), endTime: utc("2026-05-20T10:00:00Z") },
    ]);
    expect(r.size).toBe(0);
  });

  it("unparseable timestamps → silently skipped", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: "not a date", endTime: "also not a date" },
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T10:30:00Z") },
    ]);
    expect(r.size).toBe(1);
    expect(r.get("2026-05-20")).toBe(30);
  });

  it("sub-30-second residuals round to 0 and don't create a row", () => {
    // 20 seconds of "active" time on its own — rounds down to 0 min, drop.
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T10:00:20Z") },
    ]);
    expect(r.size).toBe(0);
  });

  it("rounds to nearest minute per day (not per session)", () => {
    // Three 20-second sessions = 60 seconds = 1 minute on the same day.
    // Per-session rounding would give 0+0+0; per-day rounding gives 1.
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-05-20T10:00:00Z"), endTime: utc("2026-05-20T10:00:20Z") },
      { startTime: utc("2026-05-20T11:00:00Z"), endTime: utc("2026-05-20T11:00:20Z") },
      { startTime: utc("2026-05-20T12:00:00Z"), endTime: utc("2026-05-20T12:00:20Z") },
    ]);
    expect(r.get("2026-05-20")).toBe(1);
  });

  it("date keys are YYYY-MM-DD UTC", () => {
    const r = deriveActiveMinutesByDay([
      { startTime: utc("2026-01-05T10:00:00Z"), endTime: utc("2026-01-05T10:30:00Z") },
    ]);
    expect([...r.keys()][0]).toBe("2026-01-05");
  });
});
