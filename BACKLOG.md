# Backlog

Items deferred from completed phases. The quick index below is roughly
prioritized; the detailed write-ups follow further down (and in the
"Older carryover" section).

## Active backlog (prioritized)

1. **AF → HC write-back (ExerciseSession)** — write each logged AF workout back
   into Health Connect so HC contains every workout. Detailed sketch below.
2. **Chrome Custom Tabs for OAuth** — replace the user-agent override in
   `capacitor.config.ts` with `@capacitor/browser` + deep-link return. Only
   required if publishing to the Play Store. Detail in "Older carryover".
3. **HeartRate support** — read HR from HC and feed the coach FSM. Needs a fork
   of the kiwi-health plugin. Detailed sketch below.
4. **Real-time HC content-change listener** — sync when HC content changes, not
   only on app-foreground. Needs an Android 14+ foreground service. Detail below.
5. **Profile avatar dropdown + sign-out** — the header avatar in
   `app/(app)/layout.tsx` is an inert cosmetic placeholder (noted in
   `ADAPTIVEFIT_EXECUTION_PLAN.md`). Turn it into a menu with sign-out.
6. **Voice-to-text for workout notes** — was deferred because the Web Speech
   API is unreliable on PWA. Now that the app ships in a native Capacitor
   shell, a native speech plugin (e.g. `@capacitor-community/speech-recognition`)
   is viable — worth revisiting.

> Note: `ADAPTIVEFIT_EXECUTION_PLAN.md` still has many unchecked `- [ ]` boxes,
> but those phases (3 tabs, GPS run flow, Google Fit/HC sync, cold-start, RTL,
> multi-thread coach, analytics) all shipped — see the git history. The plan's
> checkboxes are stale, not a live backlog.

---

## Workout reminders + Sunday week start — RESOLVED 2026-06-14

On-device local notifications (Capacitor Local Notifications) driven by the
training roadmap: a morning daily reminder + a pre-workout heads-up per planned
non-rest session, configurable under Settings → Workout reminders. Same caveat
as every client change — the APK is a thin shell, so it only goes live after a
Railway deploy; the `cap sync` + APK rebuild was needed only to compile the
native plugin in. Also flipped the roadmap/home/coach week anchor from Monday to
Sunday (now `dayIndex 0=Sun..6=Sat`, matching analytics). See `docs/NOTIFICATIONS.md`.
Build note: AGP 9 / Gradle 9 rejects `getDefaultProguardFile('proguard-android.txt')`;
`android/proguard-fix.gradle` rewrites that line on disk before subprojects
evaluate (a pnpm patch can't be used — the patched-dir path exceeds Windows MAX_PATH).

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

## Type-aware post-workout summary — RESOLVED 2026-05-25

Shipped as part of the coach prompt overhaul (Tier 2 #4). The post-workout
summary now runs for all four workout types (run / strength / mobility /
other) with a unified multi-discipline system prompt that adapts vocabulary
to the modality (RPE/RIR for strength, ROM/restriction for mobility, etc.).
The `if (type === "run")` gate in `logManualWorkout` was removed; type,
distance/duration, strength entries, and athlete name now flow through to
the prompt. Same overhaul applied to the chat coach (`coachChatTurn`)
system prompt with type-aware sections and example exchanges per modality.

Files touched:
- `lib/gemini/summarizePostWorkout.ts` (rewritten — multi-discipline prompt + extended input type)
- `app/(app)/home/actions.ts` (removed gate, pass new inputs; chat-coach prompt enhanced)
- `tests/gemini/summarizePostWorkout.test.ts` (new)

---

## Tracker test failures — RESOLVED 2026-05-24

All 4 failures fixed. Root causes were split between test fixture and
production code:

**3 of the 4 (tests 1, 2 in computeSplits, 4 in windowedPace):** Test
fixture bug. `straightRoute` in `tests/run/tracker.test.ts` was moving
points along longitude with a flat-earth `1/111` deg-per-km conversion
that ignored the `cos(lat)` factor. At lat 32.07°, 1° of longitude is
only ~94 km (not 111), so "100m" steps were producing points that
haversine evaluated to ~85m apart. 10 of those gave a total of 849m
instead of 1000m, never tripping the 1km split boundary. Fixed by
switching the fixture to move along latitude using
`(6371 * Math.PI / 180)` km/deg — the exact value haversine returns,
no cos-factor needed.

**1 of the 4 (computeSplits "3 km route → three splits"):** Real
production bug in `computeSplits`. Float-accumulation drift: after
30 haversine segments, `accumulated` reaches `0.999999999999632` —
just below 1 km — and the boundary check `accumulated >= 1` silently
skips emitting the third split. Fixed in `lib/run/haversine.ts` by
rewriting the loop to compare cumulative `totalKm` against integer
km boundaries `nextSplitKm = 1, 2, 3, …` with a tiny epsilon
(`SPLIT_BOUNDARY_EPSILON_KM = 1e-9`). Drift no longer compounds per
split. Also handles segments that cross multiple km boundaries (rare
but possible after a long GPS pause) via an inner `while` loop, and
skips zero-length segments cleanly.

**User-visible impact of the production fix:** Any recorded run that
exactly hits an integer km total previously lost its final split. The
fix is correct from the moment it deploys; historical `run_sessions`
rows are not re-derived (would require a backfill script if anyone
ever cares about the lost splits from before this fix).

---

## Older carryover

### Chrome Custom Tabs for OAuth
The user-agent override in `capacitor.config.ts` is the current workaround
for Google's "disallowed_useragent" block. Switching to Chrome Custom Tabs
via `@capacitor/browser` + a deep-link return is the Play-Store-policy-
compliant path; required if we ever publish. See README "Mobile shell"
section for the current trade-off note.
