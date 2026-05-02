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

/**
 * Compute per-km splits from an ordered array of accepted GPS points.
 * Returns an empty array if total distance < 1 km.
 */
export function computeSplits(points: GpsRawPoint[]): GpsSplit[] {
  if (points.length < 2) return [];

  const splits: GpsSplit[] = [];
  let kmStart = 0;          // index of the point where the current km started
  let accumulated = 0;      // distance accumulated in the current km (km)
  let tsAtKmStart = points[0].ts;
  let kmNumber = 1;

  for (let i = 1; i < points.length; i++) {
    const seg = haversineKm(
      points[i - 1].lat, points[i - 1].lon,
      points[i].lat,     points[i].lon,
    );
    accumulated += seg;

    if (accumulated >= 1) {
      // Interpolate to find exact 1 km timestamp
      const overshoot = accumulated - 1;
      const segFraction = overshoot / seg;
      const tsAtKm = points[i].ts - (points[i].ts - points[i - 1].ts) * segFraction;
      const splitSec = (tsAtKm - tsAtKmStart) / 1000;

      splits.push({ km: kmNumber, paceSec: Math.round(splitSec) });
      kmNumber++;
      tsAtKmStart = tsAtKm;
      accumulated = overshoot;
      kmStart = i;
    }
  }

  void kmStart; // used only for bookkeeping
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
