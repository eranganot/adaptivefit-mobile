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

import type { FitDailyAggregate, FitSessionSummary } from "./types";
import { normalizeExerciseType } from "./exerciseTypes";

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

// Health Connect record types we ask permission for. Must match the
// names the @kiwi-health/capacitor-health-connect plugin's RecordTypeRegistry
// recognizes — passing an unknown name crashes the bridge (the plugin
// throws IllegalArgumentException on first encounter, killing the process).
//
// HeartRate is still skipped in 8b — the kiwi-health plugin v0.0.40 doesn't
// register it in its RecordTypeRegistry. Revisit when we switch plugins or
// patch one.
//
// ExerciseSession added in 8b: lets us pull workouts recorded by Strava,
// Samsung Health, Google Fit, etc., that the user has connected to Health
// Connect. See docs/PHASE_8B_HEALTH_CONNECT_FULL.md.
export const HEALTH_READ_TYPES = [
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
  "ExerciseSession",
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

// Plugin name varies by Capacitor Health Connect plugin author. Order is
// tried in priority — the first one that exists wins.
const HEALTH_CONNECT_PLUGIN_NAMES = [
  "HealthConnectPlugin",      // @kiwi-health/capacitor-health-connect older
  "HealthConnect",            // @kiwi-health/capacitor-health-connect newer
  "CapacitorHealthConnect",   // various community packages
  "Health",                   // capacitor-health-android / @capacitor-community/health
  "CapacitorHealth",          // some forks
] as const;

function getPlugin(): HealthConnectPluginApi | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;

  const plugins = cap.Plugins ?? {};
  for (const name of HEALTH_CONNECT_PLUGIN_NAMES) {
    if (plugins[name]) {
      // First-time debug log so we know which name resolved (useful when
      // diagnosing plugin-version mismatches). Logs once per page load.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).__hcPluginLogged) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__hcPluginLogged = true;
        console.info(
          `[healthConnect] Using plugin "${name}". Available plugin keys:`,
          Object.keys(plugins),
        );
      }
      return plugins[name];
    }
  }

  // Nothing matched. Log everything we DID see so the user can tell us.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).__hcMissingLogged) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__hcMissingLogged = true;
    console.warn(
      "[healthConnect] Plugin not found. Available plugin keys:",
      Object.keys(plugins),
      "Expected one of:",
      HEALTH_CONNECT_PLUGIN_NAMES,
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export async function checkAvailability(): Promise<HealthConnectAvailability> {
  const plugin = getPlugin();
  if (!plugin) {
    // Distinguish "running on web" from "running on native but plugin failed
    // to register" — the second one is a developer/build problem and we
    // want it visible. The web case stays silent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = typeof window !== "undefined" ? (window as any).Capacitor : null;
    if (cap?.isNativePlatform?.()) {
      console.warn(
        "[healthConnect] On native platform but plugin proxy missing — " +
          "the plugin's npm package is likely not registered. Run " +
          "`pnpm cap:sync` and rebuild the APK.",
      );
    }
    return "unsupported";
  }
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

  // ── Heart rate ──
  // Skipped in MVP: the kiwi-health plugin's RecordTypeRegistry doesn't
  // recognize "HeartRate" and throws IllegalArgumentException, crashing the
  // bridge. Phase 8b will either find the right type name or switch plugins.
  // Bucket .hrSum / .hrCount stay at 0 and avgHr resolves to null.

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

/**
 * Plugin response shapes vary by version — sometimes a raw number, sometimes
 * a `{value, inMeters | inKilocalories}` object. Pull through this tolerant
 * helper instead of casting to `any` (lint config bans explicit-any). Hoisted
 * to module scope so it's not redefined on every session iteration in
 * readSessions().
 */
function numericField(rec: unknown, key: string): number {
  const v = (rec as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const obj = v as { value?: number; inMeters?: number; inKilocalories?: number };
    return obj.value ?? obj.inMeters ?? obj.inKilocalories ?? 0;
  }
  return 0;
}

/**
 * Read ExerciseSession records (workouts recorded by other apps and synced
 * into Health Connect, e.g. Strava / Samsung Health / Google Fit) for the
 * past `daysBack` days, plus per-session aggregates scoped to each session's
 * time range.
 *
 * Returns shape that maps directly to the `fit_sessions` table columns.
 *
 * Phase 8b: AdaptiveFit's own GPS-tracked runs live in `run_sessions` and
 * are NOT pulled from HC even if they're also recorded there — to avoid
 * double-counting. Server-side dedupe by (start_time within 60s + similar
 * distance) is a future Phase 8c improvement; for now we trust that the
 * user only records runs in one place.
 *
 * Days with no data return [].
 *
 * Heart-rate (avgHr/maxHr) is left null in 8b — plugin v0.0.40 doesn't
 * register the HeartRate record type, so per-session HR reads fail.
 */
export async function readSessions(
  daysBack: number,
): Promise<FitSessionSummary[]> {
  const plugin = getPlugin();
  if (!plugin) return [];

  const endTime = new Date();
  endTime.setHours(23, 59, 59, 999);
  const startTime = new Date(endTime);
  startTime.setDate(startTime.getDate() - daysBack);
  startTime.setHours(0, 0, 0, 0);

  const timeRangeFilter = {
    type: "between",
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };

  // ── List sessions in window ────────────────────────────────────
  let rawSessions: unknown[] = [];
  try {
    const res = await plugin.readRecords({
      type: "ExerciseSession",
      timeRangeFilter,
    });
    rawSessions = res.records ?? [];
  } catch (e) {
    console.warn("[healthConnect] read ExerciseSession failed:", e);
    return [];
  }

  if (rawSessions.length === 0) return [];

  // For each session, fetch scoped aggregates (distance, steps, calories).
  // Aggregates are cheap individually but we throttle here to be polite —
  // 20 sessions × 3 reads = 60 IPC calls is fine; a runner with 100+
  // sessions/30d should be split into smaller windows if perf becomes an
  // issue.
  const results: FitSessionSummary[] = [];

  for (const raw of rawSessions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = raw as any;

    const sStart: string | undefined = s.startTime ?? s.startDateTime;
    const sEnd: string | undefined = s.endTime ?? s.endDateTime;
    if (!sStart || !sEnd) continue;

    const sessionFilter = {
      type: "between",
      startTime: sStart,
      endTime: sEnd,
    };

    // Scoped distance — sum across records in the session window.
    let distanceM: number | null = null;
    try {
      const r = await plugin.readRecords({
        type: "Distance",
        timeRangeFilter: sessionFilter,
      });
      const total = (r.records ?? []).reduce<number>(
        (sum, rec) => sum + numericField(rec, "distance"),
        0,
      );
      if (total > 0) distanceM = Math.round(total);
    } catch (e) {
      console.warn("[healthConnect] session-scoped Distance failed:", e);
    }

    // Scoped active calories.
    let calories: number | null = null;
    try {
      const r = await plugin.readRecords({
        type: "ActiveCaloriesBurned",
        timeRangeFilter: sessionFilter,
      });
      const total = (r.records ?? []).reduce<number>(
        (sum, rec) => sum + numericField(rec, "energy"),
        0,
      );
      if (total > 0) calories = Math.round(total);
    } catch (e) {
      console.warn("[healthConnect] session-scoped Calories failed:", e);
    }

    // Scoped steps. Steps records use `count` (a plain number per HC docs),
    // so the helper above would also work but a direct read is clearer.
    let steps: number | null = null;
    try {
      const r = await plugin.readRecords({
        type: "Steps",
        timeRangeFilter: sessionFilter,
      });
      const total = (r.records ?? []).reduce<number>((sum, rec) => {
        const count = (rec as { count?: number }).count;
        return sum + (typeof count === "number" ? count : 0);
      }, 0);
      if (total > 0) steps = Math.round(total);
    } catch (e) {
      console.warn("[healthConnect] session-scoped Steps failed:", e);
    }

    // Stable id with fallback. HC records expose `metadata.id`; if absent,
    // derive a deterministic key so re-reads upsert cleanly.
    const fitSessionId: string =
      s.metadata?.id ??
      s.recordId ??
      s.id ??
      `${sStart}|${sEnd}|${s.exerciseType ?? "unknown"}`;

    const sourceApp: string | null =
      s.metadata?.dataOrigin?.packageName ??
      s.dataOrigin?.packageName ??
      s.packageName ??
      null;

    results.push({
      fitSessionId,
      activityType: normalizeExerciseType(s.exerciseType ?? s.activityType),
      startTime: sStart,
      endTime: sEnd,
      distanceM,
      avgHr: null,  // see top-of-function note about HR in 8b
      maxHr: null,
      steps,
      calories,
      sourceApp,
    });
  }

  return results;
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
