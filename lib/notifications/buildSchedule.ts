/**
 * lib/notifications/buildSchedule.ts
 *
 * Pure function: turn the upcoming roadmap sessions + the user's settings into
 * a concrete list of local notifications to schedule. No side effects, no
 * platform access — kept pure so it's unit-testable and reused by both the
 * scheduler component and any future preview UI.
 */

import type {
  NotificationSettings,
  PlannedSession,
  ScheduledNotification,
} from "./types";

/** Lowest id we ever generate — lets the scheduler safely identify and cancel
 *  only OUR notifications when it re-syncs. dateNum*10 for any real date is
 *  comfortably above this and below 2^31. */
export const NOTIF_ID_BASE = 100_000_000;

const KIND_CODE = { daily: 0, preWorkout: 1 } as const;

/** Build a stable integer id from a "YYYY-MM-DD" date + kind. */
export function notificationId(dateISO: string, kind: keyof typeof KIND_CODE): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dateNum = y * 10000 + m * 100 + d; // e.g. 20260609
  return dateNum * 10 + KIND_CODE[kind]; // e.g. 202606090 / 202606091
}

/** Parse "YYYY-MM-DD" + "HH:MM" into a local-time Date. */
function localDateTime(dateISO: string, hhmm: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

function formatLead(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/**
 * @param sessions Upcoming planned sessions (any order). Rest days are skipped.
 * @param settings User preferences.
 * @param now      Reference time; only notifications strictly after `now` are kept.
 */
export function buildSchedule(
  sessions: PlannedSession[],
  settings: NotificationSettings,
  now: Date = new Date(),
): ScheduledNotification[] {
  if (!settings.enabled) return [];

  const out: ScheduledNotification[] = [];

  for (const s of sessions) {
    if (s.isRest) continue;
    const title = s.title?.trim() || "Workout";

    if (settings.dailyReminder) {
      const at = localDateTime(s.dateISO, settings.dailyReminderTime);
      if (at.getTime() > now.getTime()) {
        out.push({
          id: notificationId(s.dateISO, "daily"),
          title: "Workout today 💪",
          body: `Today's session: ${title}. Don't miss it!`,
          at,
          kind: "daily",
        });
      }
    }

    if (settings.preWorkoutReminder) {
      const base = localDateTime(s.dateISO, settings.workoutTime);
      const at = new Date(base.getTime() - settings.leadMinutes * 60_000);
      if (at.getTime() > now.getTime()) {
        out.push({
          id: notificationId(s.dateISO, "preWorkout"),
          title: "Workout coming up ⏰",
          body: `${title} in ${formatLead(settings.leadMinutes)} — time to get ready.`,
          at,
          kind: "preWorkout",
        });
      }
    }
  }

  // Soonest first — purely cosmetic but makes logs/tests readable.
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}
