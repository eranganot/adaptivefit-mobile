"use client";

/**
 * Phase 8b — Auto-sync Health Connect on app foreground.
 *
 * Mounted once at the (app) layout. Listens for the WebView returning to
 * foreground (Capacitor relays Android lifecycle through document
 * `visibilitychange`) and kicks off a non-interactive HC sync, throttled to
 * once per FOREGROUND_THROTTLE_MS.
 *
 * Design notes:
 *   - No UI. Failures swallowed to console; this is best-effort.
 *   - No new dependency. `@capacitor/app` would also work but `visibilitychange`
 *     is what Capacitor itself uses under the hood; one less moving part.
 *   - Web sessions get a free no-op: syncHealthConnect short-circuits with
 *     `kind: "unsupported"` outside the native shell.
 *   - Throttle is persisted in localStorage so a fast app-restart doesn't
 *     re-spam HC reads. Survives tab refreshes; not user-scoped (single-user
 *     app — fine).
 */

import { useEffect } from "react";
import { syncHealthConnect } from "@/lib/fit/syncFromClient";

const FOREGROUND_THROTTLE_MS = 5 * 60 * 1000; // 5 min
const LAST_SYNC_KEY = "hc:last-foreground-sync-ts";

function shouldSync(): boolean {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= FOREGROUND_THROTTLE_MS;
  } catch {
    // localStorage can throw in odd contexts (private mode, sandboxed iframe).
    // Default to syncing — worst case we run an extra HC read.
    return true;
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    /* best-effort */
  }
}

async function runBackgroundSync(): Promise<void> {
  if (!shouldSync()) return;
  // Mark BEFORE awaiting — prevents two concurrent foreground events from
  // both passing the throttle check and double-firing.
  markSynced();
  try {
    const result = await syncHealthConnect({ daysBack: 7, interactive: false });
    if (result.kind !== "ok" && result.kind !== "unsupported") {
      // Non-fatal — just log. The Settings page is the user-visible escape
      // hatch and will surface real errors via its own banner.
      console.debug("[HC auto-sync] non-ok result:", result);
    }
  } catch (e) {
    console.debug("[HC auto-sync] threw:", e);
  }
}

export function HealthConnectAutoSync() {
  useEffect(() => {
    // 1. Run once on mount — covers cold-start ("app just opened").
    void runBackgroundSync();

    // 2. Subscribe to foreground transitions. `visibilitychange` fires when
    //    the document becomes visible again (Android app resumed, browser
    //    tab re-focused). We only want the visible→true edge.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void runBackgroundSync();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return null;
}
