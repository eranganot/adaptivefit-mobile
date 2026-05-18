"use client";

/**
 * Health Connect abstraction layer.
 *
 * Replaces the deprecated Google Fit REST API. Reads daily aggregates
 * (steps, distance, calories, heart rate) directly from Android's
 * Health Connect on-device store via a Capacitor plugin.
 *
 * Access pattern: we go through `window.Capacitor.Plugins.HealthConnectPlugin`
 * at runtime rather than importing the npm package directly. This mirrors
 * the fix from Phase 4's background-geolocation: avoids webpack's static
 * resolution choking on a plugin with no web entry point (Railway builds
 * the Next.js app server-side, where the native plugin can't be loaded).
 *
 * Web fallback: returns "unsupported" / empty arrays so the rest of the
 * app stays functional in a browser. Health Connect is Android-only.
 *
 * Plugin: `@kiwi-health/capacitor-health-connect` (or compatible — see
 * the plugin name in capacitor.plugins.json after `cap sync`).
 */

import type { FitDailyAggregate } from "./types";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

export type HealthConnectAvailability =
  | "available"      // installed + up to date
  | "not-installed"  // user needs to install Health Connect from Play Store
  | "needs-update"   // installed but too old
  | "unsupported";   // not Android, or older Android version

export type PermissionResult = {
  allGranted: boolean;
  granted: string[];
};

export const HEALTH_READ_TYPES = [
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
  "HeartRate",
] as const;

export type HealthReadType = (typeof HEALTH_READ_TYPES)[number];

// ─────────────────────────────────────────────────────────────────
// Internal: runtime plugin access
// ─────────────────────────────────────────────────────────────────

/** Minimal subset of the plugin's API surface we use. Typed loosely on
 *  purpose — the runtime shape is what matters; the plugin's .d.ts isn't
 *  imported (would defeat the no-static-import strategy). */
type HealthConnectPluginApi = {
  checkAvailability(): Promise<{ availability: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestHealthPermissions(opts: { read: string[]; write: string[] }): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readRecords(opts: any): Promise<{ records: any[] }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggregateRecord?: (opts: any) => Promise<any>;
  openHealthConnectSetting?: () => Promise<void>;
};

function getPlugin(): HealthConnectPluginApi | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  // The plugin name as registered by Capacitor differs slightly between
  // implementations; check both common names.
  return (
    cap.Plugins?.HealthConnectPlugin ??
    cap.Plugins?.HealthConnect ??
    null
  );
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export async function checkAvailability(): Promise<HealthConnectAvailability> {
  const plugin = getPlugin();
  if (!plugin) return "unsupported";
  try {
    const res = await plugin.checkAvailability();
    const a = String(res.availability ?? "").toLowerCase();
    if (a === "available" || a.includes("available")) return "available";
    if (a.includes("update")) return "needs-update";
    if (a.includes("install")) return "not-installed";
    return "unsupported";
  } catch (e) {
    console.warn("[healthConnect] availability check failed:", e);
    return "unsupported";
  }
}

export async function requestPermissions(): Promise<PermissionResult> {
  const plugin = getPlugin();
  if (!plugin) return { allGranted: false, granted: [] };
  try {
    const res = await plugin.requestHealthPermissions({
      read: [...HEALTH_READ_TYPES],
      write: [],
    });
    // Different plugin versions return different shapes. Normalize.
    const granted: string[] =
      res?.grantedPermissions ??
      res?.readPermissions ??
      res?.granted ??
      [];
    const allGranted: boolean =
      typeof res?.hasAllPermissions === "boolean"
        ? res.hasAllPermissions
        : granted.length === HEALTH_READ_TYPES.length;
    return { allGranted, granted };
  } catch (e) {
    console.warn("[healthConnect] requestPermissions failed:", e);
    return { allGranted: false, granted: [] };
  }
}

/**
 * Read daily aggregates (one row per UTC day) for the past `daysBack` days.
 *
 * Returns shape matches the legacy `aggregateDaily()` output so downstream
 * code (the `fitDailyMetrics` upsert) doesn't need to change.
 *
 * Days with no data are omitted (vs returning rows with all-null fields)
 * to keep the server payload compact.
 */
export async function readDailyMetrics(
  daysBack: number,
): Promise<FitDailyAggregate[]> {
  const plugin = getPlugin();
  if (!plugin) return [];

  const endTime = new Date();
  endTime.setHours(23, 59, 59, 999);
  const startTime = new Date(endTime);
  startTime.setDate(startTime.getDate() - daysBack);
  startTime.setHours(0, 0, 0, 0);

  // Health Connect's records each have a timestamp. We bucket client-side
  // by UTC date to match the legacy Google Fit aggregate semantics.
  const buckets = new Map<
    string,
    {
      steps: number | null;
      distanceM: number | null;
      activeCalories: number | null;
      totalCalories: number | null;
      hrSum: number;
      hrCount: number;
    }
  >();

  const dayKey = (d: Date) => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const ensureBucket = (key: string) => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        steps: null,
        distanceM: null,
        activeCalories: null,
        totalCalories: null,
        hrSum: 0,
        hrCount: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  const timeRangeFilter = {
    type: "between",
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };

  // ── Steps ─────────────────────────────────────────────────────
  try {
    const res = await plugin.readRecords({
      type: "Steps",
      timeRangeFilter,
    });
    for (const r of res.records ?? []) {
      const ts = new Date(r.startTime ?? r.time ?? r.endTime);
      const b = ensureBucket(dayKey(ts));
      b.steps = (b.steps ?? 0) + (r.count ?? 0);
    }
  } catch (e) {
    console.warn("[healthConnect] read Steps failed:", e);
  }

  // ── Distance ──────────────────────────────────────────────────
  try {
    const res = await plugin.readRecords({
      type: "Distance",
      timeRangeFilter,
    });
    for (const r of res.records ?? []) {
      const ts = new Date(r.startTime ?? r.time ?? r.endTime);
      const b = ensureBucket(dayKey(ts));
      // Health Connect's Distance record has `distance: { value, unit }`
      // where unit is typically "meters". Tolerate alt shapes.
      const meters =
        r.distance?.value ??
        r.distance?.inMeters ??
        r.distance ??
        0;
      b.distanceM = (b.distanceM ?? 0) + Math.round(Number(meters));
    }
  } catch (e) {
    console.warn("[healthConnect] read Distance failed:", e);
  }

  // ── Active calories ───────────────────────────────────────────
  try {
    const res = await plugin.readRecords({
      type: "ActiveCaloriesBurned",
      timeRangeFilter,
    });
    for (const r of res.records ?? []) {
      const ts = new Date(r.startTime ?? r.time ?? r.endTime);
      const b = ensureBucket(dayKey(ts));
      const kcal =
        r.energy?.value ??
        r.energy?.inKilocalories ??
        r.energy ??
        0;
      b.activeCalories = (b.activeCalories ?? 0) + Math.round(Number(kcal));
    }
  } catch (e) {
    console.warn("[healthConnect] read ActiveCaloriesBurned failed:", e);
  }

  // ── Heart rate (average across all samples that fall in the day) ──
  try {
    const res = await plugin.readRecords({
      type: "HeartRate",
      timeRangeFilter,
    });
    for (const r of res.records ?? []) {
      // HeartRate records are series with multiple samples
      const samples = r.samples ?? [];
      for (const s of samples) {
        const ts = new Date(s.time ?? r.startTime);
        const bpm = Number(s.beatsPerMinute ?? s.bpm ?? 0);
        if (!bpm) continue;
        const b = ensureBucket(dayKey(ts));
        b.hrSum += bpm;
        b.hrCount += 1;
      }
    }
  } catch (e) {
    console.warn("[healthConnect] read HeartRate failed:", e);
  }

  // ── Build result ──────────────────────────────────────────────
  const result: FitDailyAggregate[] = [];
  for (const [date, b] of buckets) {
    // Drop empty days to keep the payload small.
    if (!b.steps && !b.distanceM && !b.activeCalories && b.hrCount === 0) continue;
    result.push({
      date,
      steps: b.steps,
      distanceM: b.distanceM,
      // Active minutes not directly available in Health Connect at this
      // granularity — Phase 8b will derive from ExerciseSession durations.
      activeMinutes: null,
      avgHr: b.hrCount > 0 ? Math.round(b.hrSum / b.hrCount) : null,
      calories: b.activeCalories,
    });
  }

  // Sort oldest → newest for deterministic upsert order.
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

/** Deep-link the user into Health Connect's settings to grant / manage
 *  permissions. Useful when a permission request returns false. */
export async function openSettings(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin?.openHealthConnectSetting) return;
  try {
    await plugin.openHealthConnectSetting();
  } catch (e) {
    console.warn("[healthConnect] openSettings failed:", e);
  }
}
