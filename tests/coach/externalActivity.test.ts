/**
 * External activity summarizer tests.
 *
 * Pins the contract of summarizeExternalActivity + formatExternalActivityForPrompt:
 *   - Sessions outside the window are dropped
 *   - Invalid windows (end <= start, NaN timestamps) are skipped silently
 *   - Distance is summed only when > 0 and finite
 *   - Source app counts roll up (null → "unknown")
 *   - daysSinceLastSession computes correctly from a fixed `now`
 *   - Empty input → empty summary with all-zero numerics
 *
 * No DB, no plugin — caller supplies session rows directly.
 */
import { describe, expect, it } from "vitest";
import {
  summarizeExternalActivity,
  formatExternalActivityForPrompt,
  formatRecentSessionsForPrompt,
} from "@/lib/coach/externalActivity";

type Sess = {
  startTime: Date | string;
  endTime: Date | string;
  distanceM: number | null;
  sourceApp: string | null;
};

function sess(
  start: string,
  end: string,
  distanceM: number | null = null,
  sourceApp: string | null = "com.strava",
): Sess {
  return { startTime: new Date(start), endTime: new Date(end), distanceM, sourceApp };
}

const NOW = new Date("2026-05-25T12:00:00Z");
const WINDOW_START = new Date("2026-04-25T00:00:00Z");

describe("summarizeExternalActivity", () => {
  it("empty input → all-zero summary", () => {
    const r = summarizeExternalActivity([], WINDOW_START, NOW, NOW);
    expect(r.count).toBe(0);
    expect(r.totalActiveMin).toBe(0);
    expect(r.totalDistanceKm).toBe(0);
    expect(r.lastSessionEndIso).toBeNull();
    expect(r.daysSinceLastSession).toBeNull();
    expect(r.sourcesByApp).toEqual({});
  });

  it("single 45-min Strava run → counts, minutes, distance, source", () => {
    const r = summarizeExternalActivity(
      [sess("2026-05-24T10:00:00Z", "2026-05-24T10:45:00Z", 7000, "com.strava")],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(r.count).toBe(1);
    expect(r.totalActiveMin).toBe(45);
    expect(r.totalDistanceKm).toBe(7);
    expect(r.sourcesByApp).toEqual({ "com.strava": 1 });
    expect(r.daysSinceLastSession).toBe(1); // 24th → 25th = 1 day
    expect(r.lastSessionEndIso).toBe("2026-05-24T10:45:00.000Z");
  });

  it("multiple sources rolled up correctly", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-05-20T10:00:00Z", "2026-05-20T10:30:00Z", 5000, "com.strava"),
        sess("2026-05-21T10:00:00Z", "2026-05-21T10:30:00Z", 5000, "com.strava"),
        sess("2026-05-22T10:00:00Z", "2026-05-22T10:30:00Z", 5000, "com.sec.android.app.shealth"),
        sess("2026-05-23T10:00:00Z", "2026-05-23T10:30:00Z", 5000, null), // unknown source
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(r.count).toBe(4);
    expect(r.totalActiveMin).toBe(120);
    expect(r.totalDistanceKm).toBe(20);
    expect(r.sourcesByApp).toEqual({
      "com.strava": 2,
      "com.sec.android.app.shealth": 1,
      unknown: 1,
    });
  });

  it("sessions outside window are dropped", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-04-20T10:00:00Z", "2026-04-20T10:30:00Z", 5000), // before window
        sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000), // inside
        sess("2026-06-10T10:00:00Z", "2026-06-10T10:30:00Z", 5000), // after window
      ],
      WINDOW_START,
      NOW, // until = NOW = 2026-05-25
      NOW,
    );
    expect(r.count).toBe(1);
    expect(r.totalActiveMin).toBe(30);
  });

  it("invalid windows (end<=start) and NaN timestamps are skipped", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-05-20T10:00:00Z", "2026-05-20T10:00:00Z", 5000), // zero duration
        sess("2026-05-20T11:00:00Z", "2026-05-20T10:00:00Z", 5000), // inverted
        sess("garbage", "garbage", 5000, "com.strava"), // unparseable
        sess("2026-05-21T10:00:00Z", "2026-05-21T10:30:00Z", 5000), // valid
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(r.count).toBe(1);
    expect(r.totalActiveMin).toBe(30);
  });

  it("zero / null / negative distances don't contribute", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-05-20T10:00:00Z", "2026-05-20T10:30:00Z", null),
        sess("2026-05-21T10:00:00Z", "2026-05-21T10:30:00Z", 0),
        sess("2026-05-22T10:00:00Z", "2026-05-22T10:30:00Z", -100 as number),
        sess("2026-05-23T10:00:00Z", "2026-05-23T10:30:00Z", 5000),
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(r.count).toBe(4); // duration still counted
    expect(r.totalDistanceKm).toBe(5); // only the one with distance > 0
  });

  it("daysSinceLastSession picks the most recent end time, not the first", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-05-10T10:00:00Z", "2026-05-10T10:30:00Z"),
        sess("2026-05-23T10:00:00Z", "2026-05-23T10:30:00Z"), // most recent
        sess("2026-05-15T10:00:00Z", "2026-05-15T10:30:00Z"),
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(r.daysSinceLastSession).toBe(2); // 23rd → 25th
  });

  it("default `until` is 30 days after `since` when omitted", () => {
    const since = new Date("2026-05-01T00:00:00Z");
    const r = summarizeExternalActivity(
      [
        sess("2026-05-15T10:00:00Z", "2026-05-15T10:30:00Z"), // inside default 30d
        sess("2026-06-15T10:00:00Z", "2026-06-15T10:30:00Z"), // outside
      ],
      since,
      undefined, // use default
      NOW,
    );
    expect(r.count).toBe(1);
  });
});

describe("formatExternalActivityForPrompt", () => {
  it("returns null for empty summary", () => {
    const empty = summarizeExternalActivity([], WINDOW_START, NOW, NOW);
    expect(formatExternalActivityForPrompt(empty)).toBeNull();
  });

  it("formats session count + minutes + distance + source label", () => {
    const r = summarizeExternalActivity(
      [sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000, "com.strava")],
      WINDOW_START,
      NOW,
      NOW,
    );
    const s = formatExternalActivityForPrompt(r);
    expect(s).toContain("1 session");
    expect(s).toContain("30 active min");
    expect(s).toContain("5 km");
    expect(s).toContain("Strava");
    expect(s).toContain("yesterday"); // daysSinceLastSession === 1
  });

  it("singular vs plural session noun", () => {
    const r1 = summarizeExternalActivity(
      [sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000)],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(r1)).toContain("1 session,");

    const r2 = summarizeExternalActivity(
      [
        sess("2026-05-23T10:00:00Z", "2026-05-23T10:30:00Z", 5000),
        sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000),
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(r2)).toContain("2 sessions");
  });

  it("today / yesterday phrasing", () => {
    const today = summarizeExternalActivity(
      [sess("2026-05-25T08:00:00Z", "2026-05-25T08:30:00Z", 5000)],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(today)).toContain("today");

    const yesterday = summarizeExternalActivity(
      [sess("2026-05-24T08:00:00Z", "2026-05-24T08:30:00Z", 5000)],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(yesterday)).toContain("yesterday");

    const fiveAgo = summarizeExternalActivity(
      [sess("2026-05-20T08:00:00Z", "2026-05-20T08:30:00Z", 5000)],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(fiveAgo)).toContain("5 days ago");
  });

  it("unknown source app falls back to 'unknown source'", () => {
    const r = summarizeExternalActivity(
      [sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000, null)],
      WINDOW_START,
      NOW,
      NOW,
    );
    expect(formatExternalActivityForPrompt(r)).toContain("unknown source");
  });

  it("multi-source format sorts by count descending", () => {
    const r = summarizeExternalActivity(
      [
        sess("2026-05-20T10:00:00Z", "2026-05-20T10:30:00Z", 5000, "com.sec.android.app.shealth"),
        sess("2026-05-21T10:00:00Z", "2026-05-21T10:30:00Z", 5000, "com.strava"),
        sess("2026-05-22T10:00:00Z", "2026-05-22T10:30:00Z", 5000, "com.strava"),
        sess("2026-05-23T10:00:00Z", "2026-05-23T10:30:00Z", 5000, "com.strava"),
      ],
      WINDOW_START,
      NOW,
      NOW,
    );
    const s = formatExternalActivityForPrompt(r)!;
    expect(s.indexOf("Strava")).toBeLessThan(s.indexOf("Samsung Health"));
  });
});

describe("formatRecentSessionsForPrompt — training vs activity classification", () => {
  // The user's complaint: a 1.08 km morning walk shouldn't be called "your
  // most recent training session". The classifier flags sessions as
  // "training" only when duration ≥ 30 min OR distance ≥ 3 km. Anything
  // shorter is "activity". Bias toward "activity" so the chat coach
  // under-claims rather than over-claims training.

  it("1.08 km morning walk → activity (the original bug)", () => {
    // The exact session that caused the user complaint: 30 minutes elapsed,
    // 1.08 km. Duration is right at the boundary but distance is well below.
    // The boundary is OR, so duration ≥ 30 still triggers training. Walks
    // we want to flag as "activity" must be both short AND short-distance.
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-25T08:01:00Z", "2026-05-25T08:25:00Z", 1080, "com.sec.android.app.shealth")],
      NOW,
      3,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("likely activity"); // 24 min, 1.08 km
  });

  it("5 km run → training (clear distance signal)", () => {
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-24T07:00:00Z", "2026-05-24T07:30:00Z", 5000, "com.strava")],
      NOW,
      3,
    );
    expect(lines[0]).toContain("likely training");
  });

  it("45-min walk → training (duration over threshold even with low distance)", () => {
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-24T08:00:00Z", "2026-05-24T08:45:00Z", 2500, "com.strava")],
      NOW,
      3,
    );
    expect(lines[0]).toContain("likely training");
  });

  it("15-min stroll, 1 km → activity (both signals below threshold)", () => {
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-25T17:00:00Z", "2026-05-25T17:15:00Z", 1000, "com.strava")],
      NOW,
      3,
    );
    expect(lines[0]).toContain("likely activity");
  });

  it("3 km exact → training (distance boundary is inclusive)", () => {
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-25T08:00:00Z", "2026-05-25T08:25:00Z", 3000, "com.strava")],
      NOW,
      3,
    );
    expect(lines[0]).toContain("likely training");
  });

  it("returns up to `limit` most recent sessions, newest first", () => {
    const lines = formatRecentSessionsForPrompt(
      [
        sess("2026-05-10T10:00:00Z", "2026-05-10T10:30:00Z", 5000),
        sess("2026-05-22T10:00:00Z", "2026-05-22T10:30:00Z", 5000),
        sess("2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z", 5000),
        sess("2026-05-25T10:00:00Z", "2026-05-25T10:30:00Z", 5000),
      ],
      NOW,
      3,
    );
    expect(lines).toHaveLength(3);
    // First line should be the most recent (May 25)
    expect(lines[0]).toContain("today");
    expect(lines[1]).toContain("yesterday");
  });

  it("formats today/yesterday in Asia/Jerusalem time relative to `now`", () => {
    const lines = formatRecentSessionsForPrompt(
      [
        sess("2026-05-25T08:00:00Z", "2026-05-25T08:30:00Z", 5000),
        sess("2026-05-24T08:00:00Z", "2026-05-24T08:30:00Z", 5000),
      ],
      NOW,
      3,
    );
    expect(lines[0]).toContain("today");
    expect(lines[1]).toContain("yesterday");
  });

  it("includes duration, distance, source label", () => {
    const lines = formatRecentSessionsForPrompt(
      [sess("2026-05-25T08:00:00Z", "2026-05-25T08:30:00Z", 5230, "com.strava")],
      NOW,
      3,
    );
    expect(lines[0]).toMatch(/30 min/);
    expect(lines[0]).toMatch(/5\.23 km/);
    expect(lines[0]).toContain("Strava");
  });

  it("invalid sessions filtered out, valid ones still rendered", () => {
    const lines = formatRecentSessionsForPrompt(
      [
        sess("garbage", "garbage", 5000),
        sess("2026-05-25T11:00:00Z", "2026-05-25T10:00:00Z", 5000), // inverted
        sess("2026-05-25T08:00:00Z", "2026-05-25T08:30:00Z", 5000), // valid
      ],
      NOW,
      3,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Strava");
  });

  it("empty input → empty array", () => {
    expect(formatRecentSessionsForPrompt([], NOW, 3)).toEqual([]);
  });
});
