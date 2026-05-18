"use client";

/**
 * Client-side orchestrator for Health Connect → server sync.
 *
 * Runs entirely in the browser/native shell:
 *   1. Check Health Connect availability on this device.
 *   2. Request permissions if not granted.
 *   3. Read the last 30 days of daily aggregates.
 *   4. POST them via the syncHealthConnectData server action.
 *
 * Returns a discriminated result so the caller can show the right banner.
 *
 * Web users: returns { kind: "unsupported" } immediately. Caller hides the
 * Health Connect UI entirely on web.
 */

import {
  checkAvailability,
  readDailyMetrics,
  requestPermissions,
} from "./healthConnect";
import { syncHealthConnectData } from "@/app/(app)/settings/actions";

export type SyncResult =
  | { kind: "ok"; daysFetched: number }
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

  // Read.
  let days;
  try {
    days = await readDailyMetrics(daysBack);
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Failed to read Health Connect",
    };
  }

  // Push to server.
  const res = await syncHealthConnectData(days);
  if (!res.success) {
    return { kind: "error", message: res.error ?? "Server rejected sync" };
  }
  return { kind: "ok", daysFetched: res.daysFetched ?? 0 };
}
