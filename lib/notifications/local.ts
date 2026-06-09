"use client";

/**
 * lib/notifications/local.ts
 *
 * Thin runtime wrapper around @capacitor/local-notifications.
 *
 * IMPORTANT — access pattern: we reach the plugin through
 * `window.Capacitor.Plugins.LocalNotifications` at RUNTIME rather than
 * importing the npm package. This mirrors lib/fit/healthConnect.ts and
 * lib/run/nativeGeolocation.ts: the Next.js app is built server-side on
 * Railway and loaded into the Capacitor WebView from a remote URL, so a
 * static `import` of a native-only plugin makes webpack choke (no web entry)
 * and bloats the server bundle. The native shell registers every installed
 * plugin on `window.Capacitor.Plugins.*`, so the bridge is there at runtime.
 *
 * Web fallback: every function no-ops / reports "unsupported" so the PWA and
 * desktop browser stay functional. Local notifications are Android-only here.
 *
 * The npm dep (`@capacitor/local-notifications` in package.json) exists purely
 * so `npx cap sync android` compiles the plugin into the APK — the web code
 * never imports it.
 */

import type { ScheduledNotification } from "./types";
import { NOTIF_ID_BASE } from "./buildSchedule";

// ─────────────────────────────────────────────────────────────────
// Minimal structural types for the bits of the plugin we use. Avoids a
// compile-time dependency on the package's own d.ts.
// ─────────────────────────────────────────────────────────────────
interface PermissionStatus {
  display: "prompt" | "prompt-with-rationale" | "granted" | "denied";
}
interface PendingResult {
  notifications: Array<{ id: number }>;
}
interface LocalNotificationsPlugin {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  schedule(options: { notifications: unknown[] }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
  getPending(): Promise<PendingResult>;
  createChannel?(channel: unknown): Promise<void>;
}

const CHANNEL_ID = "workout-reminders";

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
}

function getPlugin(): LocalNotificationsPlugin | null {
  if (!isNative()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  const plugin = cap?.Plugins?.LocalNotifications as LocalNotificationsPlugin | undefined;
  return plugin ?? null;
}

/** True iff we can actually schedule native notifications right now. */
export function localNotificationsAvailable(): boolean {
  return getPlugin() !== null;
}

/**
 * Ensure we have permission to post notifications. Returns true if granted.
 * Triggers the OS prompt (Android 13+) the first time. No-op (false) on web.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    let status = await plugin.checkPermissions();
    if (status.display !== "granted") {
      status = await plugin.requestPermissions();
    }
    return status.display === "granted";
  } catch (e) {
    console.debug("[notifications] permission check failed:", e);
    return false;
  }
}

async function ensureChannel(plugin: LocalNotificationsPlugin): Promise<void> {
  if (typeof plugin.createChannel !== "function") return;
  try {
    await plugin.createChannel({
      id: CHANNEL_ID,
      name: "Workout reminders",
      description: "Reminders for your planned workouts",
      importance: 5, // IMPORTANCE_HIGH → heads-up banner
      visibility: 1,
      vibration: true,
    });
  } catch (e) {
    // Non-fatal: scheduling still works on the default channel.
    console.debug("[notifications] createChannel failed:", e);
  }
}

/** Cancel every workout-reminder we previously scheduled (ids in our range). */
async function cancelOurPending(plugin: LocalNotificationsPlugin): Promise<void> {
  try {
    const pending = await plugin.getPending();
    const ours = (pending?.notifications ?? []).filter((n) => n.id >= NOTIF_ID_BASE);
    if (ours.length > 0) {
      await plugin.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    }
  } catch (e) {
    console.debug("[notifications] cancel pending failed:", e);
  }
}

/**
 * Replace all currently-scheduled workout reminders with `items`.
 *
 * Idempotent: cancels our previous notifications first, so calling this on
 * every app foreground keeps the device schedule in sync with the roadmap
 * without piling up duplicates.
 *
 * Returns the number of notifications scheduled (0 on web / when blocked).
 */
export async function syncWorkoutNotifications(
  items: ScheduledNotification[],
): Promise<number> {
  const plugin = getPlugin();
  if (!plugin) return 0;

  await ensureChannel(plugin);
  await cancelOurPending(plugin);

  if (items.length === 0) return 0;

  const notifications = items.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    channelId: CHANNEL_ID,
    schedule: {
      at: n.at,
      // Fire even in Doze / idle — reminders are time-critical ("don't miss it").
      allowWhileIdle: true,
    },
    // No smallIcon override → plugin falls back to the app launcher icon.
  }));

  try {
    await plugin.schedule({ notifications });
    return notifications.length;
  } catch (e) {
    console.debug("[notifications] schedule failed:", e);
    return 0;
  }
}

/** Cancel all workout reminders (used when the user disables the feature). */
export async function cancelAllWorkoutNotifications(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  await cancelOurPending(plugin);
}
