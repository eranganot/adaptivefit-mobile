/**
 * lib/notifications/types.ts
 *
 * Shared types for workout reminder notifications.
 *
 * Reminders are LOCAL notifications scheduled on-device from the user's
 * training roadmap (no server push / FCM). Two kinds per planned workout day:
 *
 *   - "daily"      : a morning nudge on a day that has a workout.
 *   - "preWorkout" : a heads-up `leadMinutes` before the assumed workout time.
 *
 * The roadmap stores a calendar DATE per session but no time-of-day, so the
 * user configures a single assumed `workoutTime`; the pre-workout heads-up is
 * derived from it. All times are "HH:MM" 24h strings interpreted in the
 * device's local timezone (the WebView runs in the user's tz).
 */

export type ReminderKind = "daily" | "preWorkout";

export interface NotificationSettings {
  /** Master switch. When false the scheduler cancels everything and no-ops. */
  enabled: boolean;
  /** Send a morning reminder on workout days. */
  dailyReminder: boolean;
  /** Send a heads-up before the workout's assumed start time. */
  preWorkoutReminder: boolean;
  /** "HH:MM" — when the morning daily reminder fires. */
  dailyReminderTime: string;
  /** "HH:MM" — assumed workout start time, anchor for the pre-workout heads-up. */
  workoutTime: string;
  /** Minutes before `workoutTime` to send the pre-workout heads-up. */
  leadMinutes: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false, // opt-in: user turns it on in Settings (also triggers the OS permission prompt)
  dailyReminder: true,
  preWorkoutReminder: true,
  dailyReminderTime: "07:30",
  workoutTime: "18:00",
  leadMinutes: 120,
};

/** A planned workout as seen by the scheduler (serialisable across the
 *  server-action boundary — date is an ISO "YYYY-MM-DD" string). */
export interface PlannedSession {
  /** Local calendar date "YYYY-MM-DD". */
  dateISO: string;
  title: string;
  /** Rest/recovery days are excluded from reminders. */
  isRest: boolean;
}

/** A concrete notification to hand to the native plugin. */
export interface ScheduledNotification {
  /** Deterministic integer id so re-runs replace rather than duplicate. */
  id: number;
  title: string;
  body: string;
  /** When it should fire (local time). */
  at: Date;
  kind: ReminderKind;
}
