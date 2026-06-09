"use client";

/**
 * WorkoutRemindersSection — Settings card for on-device workout reminders.
 *
 * Stores preferences in localStorage (lib/notifications/settings) and, on any
 * change, dispatches `af:notif-settings-changed` so the always-mounted
 * WorkoutNotificationScheduler re-syncs the device schedule immediately
 * (including firing the OS permission prompt the first time it's enabled).
 *
 * Reminders only fire inside the native Android shell; in a plain browser we
 * show a hint instead of pretending it works.
 */

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/lib/notifications/settings";
import { localNotificationsAvailable } from "@/lib/notifications/local";
import { NOTIF_SETTINGS_CHANGED_EVENT } from "@/components/custom/WorkoutNotificationScheduler";
import type { NotificationSettings } from "@/lib/notifications/types";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notifications/types";

const LEAD_OPTIONS = [
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 180, label: "3 hours before" },
];

export function WorkoutRemindersSection() {
  const [settings, setSettings] = useState<NotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS,
  );
  const [isNative, setIsNative] = useState(true);

  // Hydrate from localStorage on mount (avoids SSR/client mismatch).
  useEffect(() => {
    setSettings(loadNotificationSettings());
    setIsNative(localNotificationsAvailable());
  }, []);

  // Persist + notify the scheduler whenever settings change.
  function update(patch: Partial<NotificationSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveNotificationSettings(next);
      // Defer so localStorage is committed before the scheduler reads it.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(NOTIF_SETTINGS_CHANGED_EVENT));
      }
      return next;
    });
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Bell className="w-5 h-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Workout reminders
        </h2>
      </div>

      {!isNative && (
        <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-2xl p-3">
          Reminders are delivered by the Android app. Open AdaptiveFit on your
          phone to receive them — settings here still save.
        </p>
      )}

      {/* Master toggle */}
      <ToggleRow
        label="Enable reminders"
        description="Notify me about workouts in my roadmap"
        checked={settings.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      {settings.enabled && (
        <div className="space-y-4 pt-1">
          {/* Daily morning reminder */}
          <ToggleRow
            label="Daily reminder"
            description="A morning nudge on days you have a workout"
            checked={settings.dailyReminder}
            onChange={(v) => update({ dailyReminder: v })}
          />
          {settings.dailyReminder && (
            <TimeRow
              label="Reminder time"
              value={settings.dailyReminderTime}
              onChange={(v) => update({ dailyReminderTime: v })}
            />
          )}

          {/* Pre-workout heads-up */}
          <ToggleRow
            label="Pre-workout heads-up"
            description="A reminder shortly before your workout"
            checked={settings.preWorkoutReminder}
            onChange={(v) => update({ preWorkoutReminder: v })}
          />
          {settings.preWorkoutReminder && (
            <>
              <TimeRow
                label="Workout time"
                value={settings.workoutTime}
                onChange={(v) => update({ workoutTime: v })}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  Heads-up
                </span>
                <select
                  value={settings.leadMinutes}
                  onChange={(e) => update({ leadMinutes: Number(e.target.value) })}
                  className="rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm font-medium"
                >
                  {LEAD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-gray-900 dark:text-white">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-indigo-500" : "bg-gray-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function TimeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm font-medium"
      />
    </div>
  );
}
