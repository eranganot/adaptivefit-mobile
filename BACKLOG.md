# Backlog

Items deferred from completed phases. Not in priority order — pick by what
becomes painful first.

---

## Phase 8b carryover — Health Connect

### AF → HC write-back (ExerciseSession)
**What:** When a workout is logged in AdaptiveFit (manual entry, GPS run, or
auto-finished run from the live tracker), also write an ExerciseSession
record into Health Connect. Closes the loop so HC genuinely contains every
workout the user has done in AF.

**Why we deferred it:**
- The `@kiwi-health/capacitor-health-connect` plugin supports `writeRecords`
  for ExerciseSession but the type mapping for our workout_types (running /
  cardio / strength / mobility / other) needs careful design — HC has a fixed
  enum (`ExerciseType.RUNNING`, `STRENGTH_TRAINING`, etc.).
- Need a stable client-side ID per AF workout to prevent the next foreground
  sync from re-importing our own writes as duplicates. The plugin lets you
  set `metadata.clientRecordId` — wire that to `workout_logs.id`.
- Round-trip risk: if HC re-emits the record back to us on next read with a
  different rounded `startTime` or `duration`, our equality check needs to be
  tolerant.

**Sketch when picking it up:**
1. New file `lib/fit/writeBack.ts` exporting `writeWorkoutToHC(log: WorkoutLog)`.
2. Call it after every successful `workout_logs` insert.
3. Map `workout_logs.type` → `ExerciseType.*`. Default to `OTHER` for
   anything we don't recognise.
4. Backfill: `scripts/backfill-hc.ts` that walks every existing `workout_logs`
   row and writes them. One-shot, guarded by a `hcSyncedAt` column on
   workout_logs so re-runs are idempotent.

### HeartRate support
**What:** Read HeartRate records from Health Connect (avg, max, samples) and
use them as a passive signal in the coach FSM (high HR + low RPE = either
fitness gain or under-reporting effort).

**Why we deferred it:**
- The kiwi-health plugin's `RecordTypeRegistry` doesn't include
  `HeartRateRecord` — calling `readRecords({ type: "HeartRate" })` throws
  `Unexpected RecordType`. Fixed in ~30 lines of Kotlin:
  ```kotlin
  RecordTypeRegistry.register(
      "HeartRate", HeartRateRecord::class,
      ::deserialiseHeartRate, ::serialiseHeartRate
  )
  ```
  but that means forking the plugin and vendoring it.

**Picking it up:**
1. Fork `@kiwi-health/capacitor-health-connect` to a `/vendor/` dir.
2. Add HeartRate to RecordTypeRegistry + de/serialise functions.
3. Reference it from package.json via `file:vendor/...`.
4. Add `READ_HEART_RATE` to AndroidManifest + the perm set.
5. Add `avgHr` rendering somewhere (analytics? home widget?).
6. Wire avg_hr into the coach FSM as an input (Phase 9-ish — separate work).

### Real-time content-change listener
**What:** A WorkManager-backed listener that triggers a sync whenever HC's
content changes (i.e. your watch finishes recording a walk), so analytics
never lags. Today, sync only runs on app-foreground.

**Why we deferred it:**
- Android 14+ requires a foreground-service notification for persistent
  background work. That's a permanent notification in the user's tray —
  acceptable for a fitness tracker, but adds OS-level permission churn.
- Foreground sync (current behaviour) already covers the "open the app, see
  fresh data" expectation. Real-time matters only if you stare at analytics
  without opening the app first — unusual.

**Picking it up:**
- See HC docs: `HealthConnectClient.getChangesToken` + WorkManager periodic
  worker that diff-syncs based on the token.

---

## Older carryover

### Chrome Custom Tabs for OAuth
The user-agent override in `capacitor.config.ts` is the current workaround
for Google's "disallowed_useragent" block. Switching to Chrome Custom Tabs
via `@capacitor/browser` + a deep-link return is the Play-Store-policy-
compliant path; required if we ever publish. See README "Mobile shell"
section for the current trade-off note.
