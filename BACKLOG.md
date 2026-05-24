# Backlog

Items deferred from completed phases. Not in priority order — pick by what
becomes painful first.

---

## HC "Permission denied" false-negative — UNRESOLVED after multiple attempts

**Symptom (confirmed on device 2026-05-24):** All 4 required permissions
(Steps, Distance, ActiveCaloriesBurned, TotalCaloriesBurned) are granted at
the OS level — verified via Health Connect's App Access screen — yet
AdaptiveFit's Settings page shows "Permission denied. Grant data access in
Health Connect settings." every time the user taps Sync now.

**Logcat fingerprint** (Pixel 9, Android 16, API 36):
```
V Capacitor: requestHealthPermissions called with read=[Steps,Distance,
             ActiveCaloriesBurned,TotalCaloriesBurned]
V Activity: No requestable permission in the request.
D Capacitor: Unable to find a Capacitor plugin to handle permission
             requestCode, trying Cordova plugins ...
E Capacitor: Couldn't save last HealthConnect's Plugin
             requestHealthPermissions call
I chromium: [INFO:CONSOLE:76] "Uncaught (in promise) TypeError: Failed
             to execute 'clone' on 'Response': Response body is already
             used", source: .../sw.js (76)
```
Note the recurring `sw.js` "Response body is already used" error — service
worker is mid-flight when the HC callback returns. Possible link.

**What we tried (all in code, all verified by unit tests, all still fail
on device):**

1. **String-matcher normalization** — fixed `lib/fit/healthConnect.ts`
   to strip non-alphanumerics so `ActiveCaloriesBurned` matches
   `android.permission.health.READ_ACTIVE_CALORIES_BURNED`. Tests in
   `tests/fit/healthConnect.test.ts` cover both shapes. ✓ unit-passes,
   ✗ on-device.

2. **Read `hasAllPermissions` directly** from the plugin response (the
   plugin's `.d.ts` documents it as the authoritative signal). Added a
   `buildPermissionResult()` helper that prefers the boolean flag and
   falls back to string matching only when absent. ✓ unit-passes,
   ✗ on-device.

3. **Fallback to `plugin.checkHealthPermissions()`** when
   `requestHealthPermissions` returns empty (the "no requestable
   permission" path). Adopt the check-result only if it strictly
   improves on the request-result. ✓ unit-passes, ✗ on-device.

4. **Harmonize `missing` with `allGranted`** so the banner can't claim
   "missing: Steps, Distance" when the plugin reports everything as
   granted. ✓ unit-passes, ✗ on-device.

5. **UI**: switched the banner from auto-redirect to explicit Settings-
   button guidance, named the missing types. Banner still shows because
   the underlying `allGranted: false` resolution hasn't changed
   on-device.

**Hypotheses for what's actually wrong (try in order next attempt):**

a) **Service-worker caching** — the production app is served from
   `adaptivefit-mobile-production.up.railway.app` and registers an
   `sw.js`. The new client-side JS (with the fix) may never be loaded
   because the SW is serving the old bundle. Verify by: bumping the SW
   cache version / forcing skipWaiting, or rebuilding with a new
   Next.js asset hash and confirming `__hcPluginLogged` console log
   shows the *new* response keys.

b) **API 36 / Android 16 incompatibility** — the kiwi-health plugin
   v0.0.40 was last published before Android 16 stable. Its
   `onRequestPermissionsResult` handler may not register cleanly on
   API 36 — note the `Unable to find a Capacitor plugin to handle
   permission requestCode` log line. The callback is getting lost
   between Health Connect's permission activity and Capacitor's
   bridge. Try: upgrade Capacitor to v7 (currently v6 per
   package.json), bump kiwi-health to a fork that targets API 36, or
   switch plugins entirely (`@capacitor-community/health` candidate).

c) **The actual response shape we never see** — neither
   `hasAllPermissions` nor `grantedPermissions` may be populated on
   the API 36 path. The diagnostic warn-log added in attempt (3)
   would surface the actual response keys if the new JS bundle ever
   loaded (gated by hypothesis a). Capture `adb logcat | grep
   healthConnect` AFTER confirming the cache is busted.

d) **Capacitor v6 permission bridge bug** — the
   `Couldn't save last HealthConnect's Plugin requestHealthPermissions
   call` line suggests Capacitor's permission-result restoration is
   failing. Filed in Capacitor's issue tracker as #6918 historically;
   may need a Capacitor patch or a different permission-request
   strategy (e.g. don't suspend the app between request and result).

**Recovery path when picking this back up:**
1. First confirm the SW isn't serving stale JS — bump cache version,
   uninstall+reinstall the app, OR set the app to dev mode with SW
   disabled. Verify by adding a console.log inside `requestPermissions`
   with a unique string and watching for it in logcat.
2. Then re-run Sync and capture the actual `requestResponseKeys` and
   `requestHasAllPermissions` values from the diagnostic warn-log.
3. If those are populated as expected → the on-device fix is now live
   and the bug is one we already addressed (just wasn't deployed).
4. If they're empty/absent → that's the real bug and we need
   hypothesis (b) or (c).

**Why we're putting this down for now:** Daily aggregate data still
syncs successfully when the user manually grants perms via the system
settings deep-link (which we kept working). The "Permission denied"
banner is wrong but the data path beneath it isn't blocked for active
use. Higher-leverage user-facing work (strength logging, manual
workout types) is unblocked and proceeds first.

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

## Type-aware post-workout summary

After Phase 8b.3 (strength logging UI) shipped, `summarizePostWorkout` is
called only for `type === "run"` and skipped for strength/mobility/other,
which use generic copy. The Gemini prompt is hardcoded as a "conservative
running coach assistant" and would produce off-topic suggestions for the
other types.

**Pickup:**
1. Refactor `lib/gemini/summarizePostWorkout.ts` to accept `type` and
   `strengthEntries?: { exercise, weightKg, reps, sets }[]` as inputs.
2. Branch the system prompt by type — "running coach" for runs,
   "strength coach" for strength (use the entries as additional context),
   "mobility/recovery coach" for mobility, generic for other.
3. Remove the `if (type === "run")` gate in `logManualWorkout` so all
   types get AI summaries again.
4. Add tests pinning the summary prompt for each type.

Effort: ~1h.

---

## Pre-existing test failures — GPS run tracker

Surfaced 2026-05-24 during the Phase 8b.2 verification run. Four tests in
`tests/run/tracker.test.ts` fail against the current `lib/run/tracker.ts` +
`lib/run/haversine.ts`. The HC permission work didn't touch any tracker code
— these are real, pre-existing bugs in the run-tracking math. Run data
correctness is affected (your last km isn't counted; reported pace is too
slow), so worth fixing before the next training-data analysis.

**Failures (from `pnpm test`):**

1. `isPointValid > velocity at exactly max → valid` — expected `true`, got
   `false`. Boundary off-by-one: `isPointValid` uses `>` where the test
   expects `>=` (or vice versa) when comparing velocity against
   `MAX_VELOCITY_MS`. Likely a one-character change.

2. `computeSplits > exactly 1 km → one split` — expected length 1, got 0.
   The final partial km isn't being closed. Likely the split-emission loop
   exits without flushing the in-progress accumulator when the route ends
   exactly on a km boundary.

3. `computeSplits > 3 km route → three splits` — expected 3, got 2. Same
   root cause as #2 — the final km isn't being emitted. Off-by-one in the
   loop's termination condition.

4. `windowedPace > 2 points 100m apart over 30s → ~300 sec/km` — expected
   pace < 320 sec/km, got 353. Pace interpolation is ~17% high on a 30s
   window. Two candidates: (a) the window includes both endpoints when it
   should be half-open, inflating the time-denominator; (b) haversine is
   summing segment distance differently than the test fixture assumes.

**How to pick this up:**
1. `pnpm test -- tests/run/tracker.test.ts` to scope to just these 4.
2. Walk the assertions and patch each in turn — they're independent (1) and
   paired (2+3), with (4) standalone.
3. Likely <100 LoC total. After fixing, backfill `run_sessions` with the
   corrected pace/splits via a one-shot migration if the historical numbers
   are off enough to matter for the coach FSM's RPE/pace correlation.

---

## Older carryover

### Chrome Custom Tabs for OAuth
The user-agent override in `capacitor.config.ts` is the current workaround
for Google's "disallowed_useragent" block. Switching to Chrome Custom Tabs
via `@capacitor/browser` + a deep-link return is the Play-Store-policy-
compliant path; required if we ever publish. See README "Mobile shell"
section for the current trade-off note.
