/**
 * Pure geographic utilities for the GPS run tracker.
 * Kept in a separate file so Vitest can test them without a DOM.
 */

const EARTH_RADIUS_KM = 6371;

/** Haversine distance between two lat/lon points in kilometres */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GpsRawPoint = {
  lat: number;
  lon: number;
  ts: number;        // Unix ms
  accuracy: number;  // metres
  altitude?: number;
};

export type GpsSplit = {
  km: number;        // split number (1, 2, 3…)
  paceSec: number;   // seconds per km for this split
};

/** Filter criteria constants */
export const GPS_FILTER = {
  MAX_ACCURACY_M: 25,    // Discard points with accuracy worse than this
  MAX_VELOCITY_MS: 8,    // ~28.8 km/h — faster than this is noise/vehicle
} as const;

/**
 * Accepts a raw GPS point, returning false if it should be discarded.
 * prev may be null for the very first point.
 */
export function isPointValid(
  point: GpsRawPoint,
  prev: GpsRawPoint | null,
): boolean {
  if (point.accuracy > GPS_FILTER.MAX_ACCURACY_M) return false;
  if (!prev) return true;

  const distKm = haversineKm(prev.lat, prev.lon, point.lat, point.lon);
  const dtSec = (point.ts - prev.ts) / 1000;
  if (dtSec <= 0) return false;

  const velocityMs = (distKm * 1000) / dtSec;
  return velocityMs <= GPS_FILTER.MAX_VELOCITY_MS;
}

/** Tolerance for the "did we cross a km boundary?" comparison. Float
 *  accumulation across many haversine segments drifts by ~1e-13 per
 *  segment — a 30-km route can accumulate ~3e-12 of drift, so a 1µm
 *  epsilon is safely under any real measurement noise while clearing
 *  the float-drift band. Without this, a route that actually covers
 *  N km can emit only N-1 splits because the last one lands at e.g.
 *  0.99999999999963 — just under the integer boundary. */
const SPLIT_BOUNDARY_EPSILON_KM = 1e-9;

/**
 * Compute per-km splits from an ordered array of accepted GPS points.
 * Returns an empty array if total distance < 1 km.
 *
 * Tracks cumulative distance against integer km boundaries (1, 2, 3, …)
 * rather than per-km accumulators — float drift is bounded by the total
 * distance instead of compounding per split, which fixes the "last km
 * isn't counted" bug on routes that exactly hit an integer total.
 *
 * Handles segments that span more than one km boundary (rare in practice
 * — single GPS samples are seconds apart — but possible after a long
 * pause-then-jump) via the inner `while` loop.
 */
export function computeSplits(points: GpsRawPoint[]): GpsSplit[] {
  if (points.length < 2) return [];

  const splits: GpsSplit[] = [];
  let totalKm = 0;
  let nextSplitKm = 1;
  let tsAtPrevSplit = points[0].ts;

  for (let i = 1; i < points.length; i++) {
    const seg = haversineKm(
      points[i - 1].lat, points[i - 1].lon,
      points[i].lat,     points[i].lon,
    );
    if (seg <= 0) continue;
    const prevTotal = totalKm;
    totalKm += seg;

    // Emit a split for every km boundary this segment crossed. Usually
    // 0 or 1 iterations; >1 only if the segment is unusually long.
    while (totalKm + SPLIT_BOUNDARY_EPSILON_KM >= nextSplitKm) {
      // Fraction of THIS segment at which we hit the km boundary.
      // Clamped to [0, 1] so a small negative from the epsilon doesn't
      // wrap into a future timestamp.
      const distanceIntoSegmentKm = Math.max(0, nextSplitKm - prevTotal);
      const segFraction = Math.min(1, distanceIntoSegmentKm / seg);
      const tsAtKm =
        points[i - 1].ts + (points[i].ts - points[i - 1].ts) * segFraction;
      const splitSec = (tsAtKm - tsAtPrevSplit) / 1000;

      splits.push({ km: nextSplitKm, paceSec: Math.round(splitSec) });
      tsAtPrevSplit = tsAtKm;
      nextSplitKm++;
    }
  }

  return splits;
}

/**
 * 30-second windowed pace (seconds per km).
 * Returns null if there are fewer than 2 points in the window.
 */
export function windowedPace(
  points: GpsRawPoint[],
  windowMs = 30_000,
): number | null {
  if (points.length < 2) return null;
  const now = points[points.length - 1].ts;
  const cutoff = now - windowMs;
  const window = points.filter((p) => p.ts >= cutoff);
  if (window.length < 2) return null;

  let dist = 0;
  for (let i = 1; i < window.length; i++) {
    dist += haversineKm(window[i - 1].lat, window[i - 1].lon, window[i].lat, window[i].lon);
  }
  const dtSec = (window[window.length - 1].ts - window[0].ts) / 1000;
  if (dist === 0 || dtSec === 0) return null;
  return Math.round(dtSec / dist);
}
