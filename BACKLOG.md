# Backlog

Items deferred from completed phases. Not in priority order — pick by what
becomes painful first.

---

## HC "Permission denied" false-negative — RESOLVED 2026-05-24

**Outcome:** Fixed. Verified on device after Railway deploy — Sync now
reports "Synced — 31 days updated" with all 4 required perms granted.

**Root cause (the real one):** Mostly a deployment confusion. The fixes
landed in the code but `pnpm cap:sync` + Gradle APK rebuild only refresh
the native shell — the JS bundle is served from Railway (`capacitor.config.ts`
points `server.url` at the Railway URL). Until the code was committed,
pushed, and Railway redeployed, the WebView kept loading the old bundle.

**The actual code fix that did the work:** `buildPermissionResult()` in
`lib/fit/healthConnect.ts` now reads `hasAllPermissions: boolean` directly
from the plugin response (the kiwi-health `.d.ts` documents this as the
authoritative signal). String-matching is kept as a fallback for older
plugin shapes but isn't the primary path. This handles the "No requestable
permission in the request" case — when all perms are already granted at
the OS level, the plugin's `requestHealthPermissions` returns with empty
`grantedPermissions` but `hasAllPermissions: true`. Earlier matcher-only
logic saw the empty array and reported "denied".

**Lessons (kept here so we don't repeat them):**
- AdaptiveFit's APK is a thin shell. Client-side fixes need `git push`
  to Railway — not a Capacitor sync — to reach the device.
- The `sw.js` (`Response body is already used`) console errors are
  unrelated to HC and predate this work. Logging them for context but
  not chasing them as part of HC investigation.
- The `Unable to find a Capacitor plugin to handle permission requestCode`
  log line is normal for the kiwi-health flow (it routes through
  Health Connect's intent rather than Android's runtime perms) — not a
  bug indicator.

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
