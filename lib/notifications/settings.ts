"use client";

/**
 * lib/notifications/settings.ts
 *
 * Persistence for workout-reminder preferences.
 *
 * Single-user app → we store settings in localStorage (same lightweight
 * pattern as theme and the Health-Connect sync throttle), not the DB. The
 * WebView's localStorage survives app restarts, so a chosen schedule sticks.
 * No DB migration required.
 */

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "./types";

const STORAGE_KEY = "af:notif-settings";

export function loadNotificationSettings(): NotificationSettings {
  if (typeof window === "undefined") return { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    // Merge over defaults so a newly-added field never comes back undefined.
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* best-effort — private mode / quota can throw */
  }
}
