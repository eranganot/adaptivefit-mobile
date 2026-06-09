"use client";

/**
 * WorkoutNotificationScheduler
 *
 * Mounted once in the (app) layout (next to HealthConnectAutoSync). On app
 * cold-start and on every return-to-foreground (throttled), it re-syncs the
 * on-device local notifications with the user's training roadmap so reminders
 * always reflect the latest plan — added sessions, reschedules, completions.
 *
 * Design (mirrors HealthConnectAutoSync):
 *   - No UI. Best-effort; failures swallowed to console.
 *   - Web / non-native: every step no-ops, so the PWA stays clean.
 *   - Throttled via localStorage so a fast app-restart doesn't re-spam the
 *     scheduler. Re-sync is cheap but we don't need it more than every few min.
 *   - A custom `af:notif-settings-changed` window event lets the Settings UI
 *     force an immediate re-sync when the user changes preferences.
 */

import { useEffect } from "react";
import { loadNotificationSettings } from "@/lib/notifications/settings";
import { buildSchedule } from "@/lib/notifications/buildSchedule";
import {
  localNotificationsAvailable,
  ensureNotificationPermission,
  syncWorkoutNotifications,
  cancelAllWorkoutNotifications,
} from "@/lib/notifications/local";
import { getUpcomingPlannedSessions } from "@/app/(app)/roadmap/notificationActions";

const THROTTLE_MS = 5 * 60 * 1000; // 5 min
const LAST_SYNC_KEY = "af:notif-last-sync-ts";
export const NOTIF_SETTINGS_CHANGED_EVENT = "af:notif-settings-changed";

function shouldSync(force: boolean): boolean {
  if (force) return true;
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= THROTTLE_MS;
  } catch {
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

async function runSync(force: boolean): Promise<void> {
  if (!localNotificationsAvailable()) return; // web / not in native shell
  if (!shouldSync(force)) return;
  markSynced();

  try {
    const settings = loadNotificationSettings();

    if (!settings.enabled) {
      // Feature off → make sure nothing stale is left scheduled.
      await cancelAllWorkoutNotifications();
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) return;

    const sessions = await getUpcomingPlannedSessions();
    const schedule = buildSchedule(sessions, settings, new Date());
    await syncWorkoutNotifications(schedule);
  } catch (e) {
    console.debug("[notif scheduler] sync threw:", e);
  }
}

export function WorkoutNotificationScheduler() {
  useEffect(() => {
    // 1. Cold-start sync.
    void runSync(false);

    // 2. Foreground transitions (Android resume → document becomes visible).
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runSync(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 3. Settings changes → force an immediate re-sync, bypassing throttle.
    const onSettingsChanged = () => void runSync(true);
    window.addEventListener(NOTIF_SETTINGS_CHANGED_EVENT, onSettingsChanged);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(NOTIF_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    };
  }, []);

  return null;
}
