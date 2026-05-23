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
  | { kind: "permission-denied" }
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

  // Health Connect is installed. Request permissions.
  // The plugin will only prompt if we don't already have them.
  if (interactive) {
    const perms = await requestPermissions();
    if (!perms.allGranted) {
      return { kind: "permission-denied" };
    }
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
  // We don't fail the whole sync if sessions fail — daily aggregates are
  // still worth shipping. Sessions are mostly a bonus signal (gym workouts,
  // walks recorded by the watch) and a plugin hiccup here shouldn't black
  // out the Home "Yesterday" widget.
  let sessions: Awaited<ReturnType<typeof readSessions>> = [];
  try {
    sessions = await readSessions(daysBack);
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
