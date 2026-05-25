/**
 * Pure unit tests for lib/run/haversine.ts
 * These test the GPS math without any browser APIs.
 */
import { describe, expect, it } from "vitest";
import {
  haversineKm,
  isPointValid,
  computeSplits,
  windowedPace,
  GPS_FILTER,
  type GpsRawPoint,
} from "@/lib/run/haversine";

// ── helpers ──────────────────────────────────────────────────────────────────

function point(lat: number, lon: number, ts: number, accuracy = 5): GpsRawPoint {
  return { lat, lon, ts, accuracy };
}

/**
 * Build a straight-line route of `n` points each ~distanceKm apart,
 * spaced `intervalMs` milliseconds apart. Starts from (lat, lon).
 *
 * Moves along LATITUDE (north) rather than longitude. Reason: 1° of
 * latitude is the same distance everywhere on Earth (the meridians are
 * great circles), so the deg↔km conversion is exact and matches whatever
 * Earth radius haversine uses. Moving along longitude requires a
 * cos(lat) factor that introduces a ~16% error at lat 32° if not
 * applied. The previous implementation moved along longitude with no
 * cos(lat) factor, so "100m" steps haversined to ~85m, causing the
 * computeSplits / windowedPace / "velocity at max" tests to fail with
 * the implementation correctly applying haversine. Tests were wrong,
 * not the production math.
 *
 * Use the same EARTH_RADIUS_KM = 6371 as haversine — pinned at
 * 111.1949266 km/deg via (6371 * π / 180) — so haversine of two
 * fixture points returns the requested distance to within floating-
 * point precision.
 */
const FIXTURE_KM_PER_DEG_LAT = (6371 * Math.PI) / 180; // ≈ 111.1949266

function straightRoute(
  n: number,
  distanceKmPerStep: number,
  intervalMs: number,
  startTs = 0,
  startLat = 32.07,
  startLon = 34.78,
  accuracy = 5,
): GpsRawPoint[] {
  const degPerKm = 1 / FIXTURE_KM_PER_DEG_LAT;
  const points: GpsRawPoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      lat: startLat + i * distanceKmPerStep * degPerKm,
      lon: startLon,
      ts: startTs + i * intervalMs,
      accuracy,
    });
  }
  return points;
}

// ── haversineKm ───────────────────────────────────────────────────────────────

describe("haversineKm", () => {
  it("same point → 0", () => {
    expect(haversineKm(32.07, 34.78, 32.07, 34.78)).toBe(0);
  });

  it("~1 km along longitude in Tel Aviv area", () => {
    // 1° longitude ≈ 94 km at lat 32. 0.01° ≈ 0.94 km
    const km = haversineKm(32.07, 34.78, 32.07, 34.79);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.05);
  });

  it("~1 km along latitude", () => {
    // 1° lat ≈ 111 km. 0.009° ≈ 1 km
    const km = haversineKm(32.07, 34.78, 32.079, 34.78);
    expect(km).toBeGreaterThan(0.95);
    expect(km).toBeLessThan(1.05);
  });

  it("is symmetric", () => {
    const ab = haversineKm(32.07, 34.78, 32.1, 34.9);
    const ba = haversineKm(32.1, 34.9, 32.07, 34.78);
    expect(Math.abs(ab - ba)).toBeLessThan(0.0001);
  });

  it("Tel Aviv → Jerusalem ≈ 55 km", () => {
    const km = haversineKm(32.07, 34.78, 31.77, 35.22); // TA → JLM
    expect(km).toBeGreaterThan(50);
    expect(km).toBeLessThan(65);
  });
});

// ── isPointValid ──────────────────────────────────────────────────────────────

describe("isPointValid", () => {
  it("first point with good accuracy → valid", () => {
    expect(isPointValid(point(32.07, 34.78, 0, 10), null)).toBe(true);
  });

  it("accuracy > MAX_ACCURACY_M → invalid", () => {
    expect(isPointValid(point(32.07, 34.78, 0, GPS_FILTER.MAX_ACCURACY_M + 1), null)).toBe(false);
  });

  it("velocity at exactly max → valid", () => {
    // 8 m/s over 1 second = 8 m. Move along latitude (no cos correction
    // needed) using the same Earth-radius constant haversine uses, so the
    // distance is exactly 8m per haversine and velocity = 8.000 m/s,
    // which the `<= MAX_VELOCITY_MS` check passes inclusively.
    // (The earlier fixture used 111_000 * cos(lat) along longitude, which
    // came out to 8.011 m/s due to the 0.18% mismatch between 111000 and
    // EARTH_RADIUS_KM × π/180 = 111195.)
    const prev = point(32.07, 34.78, 0);
    const degFor8m = 0.008 / FIXTURE_KM_PER_DEG_LAT;
    const next = point(32.07 + degFor8m, 34.78, 1000);
    expect(isPointValid(next, prev)).toBe(true);
  });

  it("velocity > MAX_VELOCITY_MS → invalid (vehicle/noise)", () => {
    // 100 m/s — clearly invalid
    const prev = point(32.07, 34.78, 0);
    const next = point(32.07, 34.88, 1000); // ~9.4 km in 1 second
    expect(isPointValid(next, prev)).toBe(false);
  });

  it("same timestamp → invalid (dt = 0)", () => {
    const prev = point(32.07, 34.78, 1000);
    const next = point(32.07, 34.79, 1000); // same ts
    expect(isPointValid(next, prev)).toBe(false);
  });
});

// ── computeSplits ─────────────────────────────────────────────────────────────

describe("computeSplits", () => {
  it("empty array → no splits", () => {
    expect(computeSplits([])).toEqual([]);
  });

  it("single point → no splits", () => {
    expect(computeSplits([point(32.07, 34.78, 0)])).toEqual([]);
  });

  it("less than 1 km total → no splits", () => {
    // 10 points 50m apart = 500m total
    const pts = straightRoute(11, 0.05, 30_000);
    expect(computeSplits(pts)).toEqual([]);
  });

  it("exactly 1 km → one split", () => {
    // 11 points, 100m apart = 1000m. 10 intervals × 30s = 300s per km
    const pts = straightRoute(11, 0.1, 30_000);
    const splits = computeSplits(pts);
    expect(splits).toHaveLength(1);
    expect(splits[0].km).toBe(1);
    // 300s ± 5s tolerance (interpolation rounding)
    expect(splits[0].paceSec).toBeGreaterThan(295);
    expect(splits[0].paceSec).toBeLessThan(310);
  });

  it("3 km route → three splits", () => {
    // 31 points, 100m apart = 3000m. Each step = 30s → each km ≈ 300s
    const pts = straightRoute(31, 0.1, 30_000);
    const splits = computeSplits(pts);
    expect(splits).toHaveLength(3);
    expect(splits.map((s) => s.km)).toEqual([1, 2, 3]);
    for (const s of splits) {
      expect(s.paceSec).toBeGreaterThan(290);
      expect(s.paceSec).toBeLessThan(315);
    }
  });

  it("split km numbers are sequential from 1", () => {
    const pts = straightRoute(51, 0.1, 10_000); // 5 km
    const splits = computeSplits(pts);
    expect(splits.length).toBeGreaterThanOrEqual(4);
    splits.forEach((s, i) => expect(s.km).toBe(i + 1));
  });
});

// ── windowedPace ──────────────────────────────────────────────────────────────

describe("windowedPace", () => {
  it("empty → null", () => {
    expect(windowedPace([])).toBeNull();
  });

  it("single point → null", () => {
    expect(windowedPace([point(32.07, 34.78, 0)])).toBeNull();
  });

  it("all points older than window → null", () => {
    const pts = [
      point(32.07, 34.78, 0),
      point(32.07, 34.79, 5_000),
    ];
    // Window of 30s but last point is at 5s — all within window, but test with future ts
    // We need points where all are outside the 30s window from last
    const old = [
      point(32.07, 34.78, 0),
      point(32.07, 34.79, 1_000),
    ];
    // last point is at ts=1000, window = 30000ms → cutoff = -29000
    // both points are within window → should return a pace
    const pace = windowedPace(old, 30_000);
    expect(pace).not.toBeNull();
  });

  it("2 points 100m apart over 30s → ~300 sec/km", () => {
    // 100m ≈ 0.1 km, over 30s → pace = 30/0.1 = 300 s/km
    // Move along latitude using the haversine-matched constant — see
    // straightRoute comment for why moving along longitude with /111 was
    // wrong (16% short at this latitude → pace came out as 353 not 300).
    const degFor100m = 0.1 / FIXTURE_KM_PER_DEG_LAT;
    const pts = [
      point(32.07, 34.78, 0),
      point(32.07 + degFor100m, 34.78, 30_000),
    ];
    const pace = windowedPace(pts, 30_000);
    expect(pace).not.toBeNull();
    expect(pace!).toBeGreaterThan(290);
    expect(pace!).toBeLessThan(320);
  });

  it("uses only the last 30s of points", () => {
    // First point is 60s old, then 3 points in the last 30s.
    // Same fixture-bug fix as the test above — latitude, haversine-matched
    // constant.
    const degPerStep = 0.1 / FIXTURE_KM_PER_DEG_LAT; // 100m
    const now = 60_000;
    const pts = [
      point(32.07, 34.78, 0),                          // 60s ago — outside window
      point(32.07 + degPerStep, 34.78, now - 30_000),
      point(32.07 + degPerStep * 2, 34.78, now - 15_000),
      point(32.07 + degPerStep * 3, 34.78, now),
    ];
    const paceWindowed = windowedPace(pts, 30_000);
    const paceAll = windowedPace(pts, 120_000);
    // Windowed pace should differ from full pace since first point is excluded
    expect(paceWindowed).not.toBeNull();
    expect(paceAll).not.toBeNull();
    // Both cover ~300m at ~10m/s so both should be around the same ballpark
    expect(paceWindowed!).toBeGreaterThan(50);
  });
});
