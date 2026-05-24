"use client";

/**
 * Client-side orchestrator for Health Connect → server sync.
 *
 * Runs entirely in the browser/native shell:
 *   1. Check Health Connect availability on this device.
 *   2. Request permissions if not granted.
 *   3. Read the last `daysBack` days of:
 *        - Daily aggregates (steps / distance / active minutes / calories)
 *        - ExerciseSession records — workouts originally recorded by Strava
 *          / Samsung Health / Google Fit and shared via Health Connect.
 *   4. POST both arrays via the syncHealthConnectData server action.
 *
 * Returns a discriminated result so the caller can show the right banner.
 *
 * Web users: returns { kind: "unsupported" } immediately. Caller hides the
 * Health Connect UI entirely on web.
 *
 * Phase-8b session reads are intentionally best-effort — if readSessions
 * throws (older plugin version, permission revoked just for ExerciseSession,
 * etc.) we still ship the daily aggregates rather than failing the whole
 * sync. Errors are logged but not surfaced as a hard failure.
 */

import {
  checkAvailability,
  readDailyMetrics,
  readSessions,
  requestPermissions,
} from "./healthConnect";
import { syncHealthConnectData } from "@/app/(app)/settings/actions";

export type SyncResult =
  | { kind: "ok"; daysFetched: number; sessionsFetched: number }
  | { kind: "unsupported"; reason: "web" | "android-too-old" }
  | { kind: "not-installed" }
  | { kind: "needs-update" }
  | { kind: "permission-denied"; missing: string[] }
  | { kind: "error"; message: string };

/**
 * One-shot sync. Default: last 30 days.
 *
 * If `interactive` is true (default), this will trigger the OS permission
 * prompt when needed. Set to false for background "refresh on app open"
 * calls so the user doesn't get a popup at an awkward time.
 */
export async function syncHealthConnect(
  options: { daysBack?: number; interactive?: boolean } = {},
): Promise<SyncResult> {
  const daysBack = options.daysBack ?? 30;
  const interactive = options.interactive ?? true;

  const availability = await checkAvailability();
  if (availability === "unsupported") {
    return { kind: "unsupported", reason: "web" };
  }
  if (availability === "not-installed") {
    return { kind: "not-installed" };
  }
  if (availability === "needs-update") {
    return { kind: "needs-update" };
  }

  // Health Connect is installed. Always check permissions, even on a
  // background sync — without it we don't know whether ExerciseSession is
  // granted, and we MUST NOT call readSessions() without that knowledge
  // (the kiwi-health plugin's denied-perm path can crash the bridge at JNI
  // with no JS-recoverable signal). Non-interactive callers skip the
  // "permission-denied" return path so they don't trigger UI noise — they
  // just don't get sessions if perms are partial.
  const perms = await requestPermissions();
  if (interactive && !perms.allGranted) {
    return { kind: "permission-denied", missing: perms.missing };
  }

  // ── Read daily aggregates (hard requirement) ─────────────────────
  let days;
  try {
    days = await readDailyMetrics(daysBack);
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Failed to read Health Connect",
    };
  }

  // ── Read ExerciseSessions (best effort, Phase 8b) ────────────────
  // Gated on the permission flag from the probe above. Even with the gate,
  // wrap in try/catch — the plugin may still throw on the bridge call for
  // reasons unrelated to permissions (e.g. an unknown sub-type returned
  // by a niche source app). Failures here log + skip; daily aggregates
  // still ship.
  let sessions: Awaited<ReturnType<typeof readSessions>> = [];
  try {
    sessions = await readSessions(daysBack, {
      hasExerciseSessionPermission: perms.hasExerciseSession,
    });
  } catch (e) {
    console.warn("[syncHealthConnect] readSessions failed (non-fatal):", e);
  }

  // Push to server.
  const res = await syncHealthConnectData({ days, sessions });
  if (!res.success) {
    return { kind: "error", message: res.error ?? "Server rejected sync" };
  }
  return {
    kind: "ok",
    daysFetched: res.daysFetched ?? 0,
    sessionsFetched: res.sessionsFetched ?? 0,
  };
}
