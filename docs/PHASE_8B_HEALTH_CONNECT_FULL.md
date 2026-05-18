# Phase 8b — Health Connect full integration (design)

Phase 8 MVP gave us daily aggregates (steps, distance, calories, HR) read on
manual sync. Phase 8b adds workout sessions and live updates.

## Goals

1. **Workout sessions** — pull `ExerciseSessionRecord`s from Health Connect
   (runs/rides/etc. recorded by Google Fit, Samsung Health, Fitbit, etc.) and
   surface them in AdaptiveFit's history alongside `run_sessions` from
   our own in-app GPS tracker.
2. **Real-time updates** — refresh fit data automatically when the user
   opens the app and/or when Health Connect notifies us of new data.
3. **Active minutes** — derive from `ExerciseSession` durations (Health
   Connect doesn't have a direct "active minutes" record like Google Fit
   did).

## Architecture changes

### Schema

`fit_sessions` already exists from the Google Fit era (`activityType`,
`startTime`, `endTime`, `distanceM`, `avgHr`, `maxHr`, `steps`, `calories`,
`route`). We can reuse it as-is — Health Connect's `ExerciseSessionRecord`
maps cleanly to those columns.

One new column for provenance / dedupe:
```sql
ALTER TABLE fit_sessions ADD COLUMN IF NOT EXISTS source_app TEXT;
-- 'google-fit', 'samsung-health', 'strava', etc. — taken from
-- ExerciseSessionRecord.metadata.dataOrigin.packageName
```

### Reads

Add to `lib/fit/healthConnect.ts`:

```ts
export async function readSessions(daysBack: number): Promise<FitSessionSummary[]>
```

Internals:
- `plugin.readRecords({ type: "ExerciseSession", timeRangeFilter })`
- For each session, additionally read `Distance`, `HeartRate`, `Steps`,
  `ActiveCaloriesBurned` records *scoped to the session's time range*
  (Health Connect supports a `dataOriginFilter` or we filter client-side).
- Build `FitSessionSummary` with the same shape as the legacy Google Fit
  client.

### Write path

Extend `syncHealthConnectData` to take both `days` and `sessions`:
```ts
syncHealthConnectData({
  days: FitDailyAggregate[],
  sessions: FitSessionSummary[],
})
```
Upsert `sessions` into `fit_sessions` keyed on `(userId, fitSessionId)`.

### Live updates

Two layers:

**Layer 1: on app focus**
- In `HomeClient`'s `useEffect`, when the app becomes visible (`document.visibilityState === 'visible'`), trigger a background sync (non-interactive — `syncHealthConnect({ interactive: false })`).
- Guard with a cooldown (no more than once every 5 min) so navigation doesn't thrash.

**Layer 2: Health Connect change notifications**
- The plugin (if it supports it — varies by version) exposes a listener for
  data-change events.
- Subscribe on app start, debounce, trigger sync.
- Alternative: register a `BroadcastReceiver` on the native side that
  schedules a `WorkManager` job to wake our app — more complex, not
  needed for MVP.

### Active minutes derivation

Once `ExerciseSessionRecord`s flow in, compute per-day active minutes:
```
active_minutes_for_date(D) =
  sum( max(0, min(session.endTime, D+1) - max(session.startTime, D)) )
  for all sessions overlapping D
  divided by 60
```
Update `fitDailyMetrics.activeMinutes` accordingly.

## UI work

- Settings: a sub-list under "Health Connect" showing which data types
  are granted ("Steps ✓ Distance ✓ Sessions ✓ HR ✗") with a per-type
  re-request button.
- Analytics: surface sessions from external apps as a separate "Synced
  from Health Connect" series alongside in-app GPS runs.
- Coach context: feed external-app session count into the FSM so a user
  who tracks runs in Strava (etc.) doesn't get penalized for "no
  workouts logged" in AdaptiveFit.

## Permissions UX

The `READ_EXERCISE` permission is added separately by Health Connect at
permission-request time. Phase 8 already requests Steps/Distance/etc.; in
8b we add:

```ts
read: [
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
  "HeartRate",
  "ExerciseSession",   // ← new in 8b
]
```

Health Connect's permission UI lets the user grant some types and not
others, so we handle partial grants:

```ts
if (perms.granted.includes("ExerciseSession")) {
  sessions = await readSessions(30);
} else {
  sessions = [];
}
```

## Estimated effort

- Sessions read + upsert: 1-2h
- Active-minutes derivation: 30 min
- On-focus auto-sync: 30 min
- Live data-change listener (if plugin supports it): 1-2h or defer
- UI polish: 1h

Total: **3-5 hours** depending on plugin capabilities.

## When to do it

Phase 8 MVP unblocks the home-screen "Yesterday" widget. Phase 8b is
quality-of-life: less manual tapping of "Sync now", and bringing in
workouts from other apps. Reasonable to wait until you have a real use
case (e.g. you do a long run on Strava and want it to show in the coach
roadmap).
