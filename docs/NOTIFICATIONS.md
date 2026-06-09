# Workout reminder notifications

On-device **local** notifications that remind you about workouts from your
training roadmap. No server push / FCM — the schedule is computed in the app
and handed to Android's alarm manager via `@capacitor/local-notifications`.

## What you get

For each upcoming **planned, non-rest** roadmap session, up to two reminders:

- **Daily reminder** — a morning nudge (default 07:30) on a day you have a workout.
- **Pre-workout heads-up** — fires a configurable lead time (default 2h) before
  your assumed workout time (default 18:00).

Days you've already logged a workout for are skipped, and rest days never
notify. The schedule re-syncs every time you open the app, so adding,
rescheduling, or completing a session keeps reminders accurate.

Configure it under **Settings → Workout reminders** (off by default; turning it
on triggers the Android notification-permission prompt).

## How it works

- `lib/notifications/types.ts` — settings + types, defaults.
- `lib/notifications/settings.ts` — persists preferences to `localStorage`
  (single-user app; no DB migration).
- `lib/notifications/buildSchedule.ts` — pure function: roadmap sessions +
  settings → concrete notifications with deterministic integer ids.
- `lib/notifications/local.ts` — runtime bridge to the native plugin via
  `window.Capacitor.Plugins.LocalNotifications` (no static import — same
  pattern as Health Connect / background-geolocation, required because the web
  app is built server-side on Railway and loaded into the WebView remotely).
- `app/(app)/roadmap/notificationActions.ts` — read-only server action returning
  upcoming planned sessions with absolute (Sunday-anchored) dates.
- `components/custom/WorkoutNotificationScheduler.tsx` — mounted in the (app)
  layout; re-syncs on cold start, on foreground (throttled 5 min), and whenever
  settings change.
- `components/settings/WorkoutRemindersSection.tsx` — the Settings UI.

Permissions added in `android/app/src/main/AndroidManifest.xml`:
`SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`
(`POST_NOTIFICATIONS` was already present).

## Build / deploy steps (required once)

The web code change deploys with Railway as usual, but the **native plugin must
be compiled into the APK**:

```bash
pnpm install                 # pulls @capacitor/local-notifications
npx cap sync android         # registers the plugin + merges its manifest
# build + install the APK as you normally do, e.g.
#   open android/ in Android Studio and Run, or
pnpm android:install-debug   # after assembling the debug APK
```

`npx cap sync android` will add `@capacitor/local-notifications` to
`android/.../capacitor.plugins.json` and the gradle plugin list automatically.

## Note on the Sunday week change

The roadmap/home/coach surfaces were switched from a Monday-anchored week to a
**Sunday-anchored** week (`dayIndex` is now `0=Sun … 6=Sat`), matching the
analytics surface. The auto-generator now writes Tuesday as `dayIndex 2` and
Friday as `dayIndex 5`, so training days are unchanged.

Existing **pending auto** roadmap rows written under the old Monday convention
will be replaced automatically the next time the roadmap regenerates (it
regenerates when the current sessions fall into the past, or when you tap
*Regenerate* on the Roadmap screen). Any manually-added rows from before the
change would shift by one day until regenerated — for a clean cutover, hit
*Regenerate* once after deploying.
