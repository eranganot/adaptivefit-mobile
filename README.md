# AdaptiveFit Mobile

Personal AI multi-sport coach. Single-user PWA for Pixel 9 on Android.
Built with Next.js 15 · Drizzle/Postgres · Gemini · Railway.

---

## What it does

AdaptiveFit is a self-hosted coaching app that replaces a Gemini chat workflow with a structured, data-driven training loop:

- **Logs every workout** across four types (run / strength / mobility / other) with RPE, foot-pain score, and free-text notes. Runs add distance + duration; strength sessions add per-exercise `weight × reps × sets` via a dedicated sheet.
- **Parses notes with Gemini** to extract structured sentiment (breathing, form, mood, pain signals) AND back-fills `distance_km` / `duration_sec` when the athlete mentions them in chat ("ran 7k in 45 min") — only when the field was left blank, never clobbering manual entries.
- **Runs a multi-discipline coach FSM** that adjusts the next session based on recent load, pain signals, goal category, and periodization phase. The chat coach prompt speaks the vocabulary of the modality at hand (RPE/RIR for strength, ROM/restriction for mobility, pace/foot-pain for running).
- **Generates a 4-week periodized training roadmap** with taper/peak/deload phases tied to a goal target date — inline editable/reschedulable from the Roadmap tab. Sessions render in strict chronological order.
- **Tracks four goal categories** (running, weight loss, body composition, strength) with per-category analytics and coaching logic.
- **Logs body weight + body fat** over time with a dedicated section in Settings.
- **Reads Health Connect** on Android via the native Capacitor shell — on-device, no cloud OAuth. Daily aggregates (Steps, Distance, ActiveCaloriesBurned, TotalCaloriesBurned) plus full ExerciseSession integration (Strava / Samsung Health / Google Fit / Fitbit) including per-session distance + duration + source app.
- **Smart classifier for external sessions** — pace + distance + duration + source app heuristic puts each session into `clearly_training` (counts), `clearly_activity` (excluded), or `ambiguous` (asks the user). The Home card and chat coach surface ambiguous sessions for one-tap labelling; the answer persists on `fit_sessions.user_classification`.
- **Active-minutes derivation** — Health Connect doesn't expose an "active minutes" aggregate, so AdaptiveFit derives it per UTC day from `ExerciseSession` durations and populates `fit_daily_metrics.active_minutes`.
- **On-focus auto-sync** — HC sync fires silently every time the app comes back to the foreground (5-min throttle), so analytics never lag behind reality.
- **Tracks live GPS runs** with a Mapbox map, real-time pace overlays, and per-km split detection (float-drift-safe).
- **Shows analytics** per goal category — weekly distance, RPE × pace trends, lift progression, weight trend, daily active-time × effort chart. The chart combines AdaptiveFit logs with classified external sessions (no double-counting; per-day "prefer workout_logs over fit_sessions" rule).
- **Persistent chat coach** as a real bottom-nav tab. Supports propose-and-approve plan changes (soften / swap / freeze / add-session / record-symptom) and the immediate-apply `classifySession` tool for ambiguous external sessions.
- **Bilingual UI** — English (LTR) and Hebrew (RTL), switchable per user.
- **PWA** — installable on Android, offline shell via service worker (v4 with eager response cloning).

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, server actions, server components) |
| Database | PostgreSQL via Railway plugin |
| ORM | Drizzle ORM (typed queries, sql migrations in `drizzle/`) |
| Auth | Auth.js v5 — Google OAuth, single-email allowlist |
| AI | Gemini 2.5 Flash for extraction + chat coach; 2.5 Pro for cold-start import |
| Maps | Mapbox GL JS (live GPS run tracker) |
| Charts | Recharts (ComposedChart, BarChart, LineChart) |
| i18n | next-intl (EN / HE) |
| UI | Tailwind CSS + shadcn/ui primitives |
| Mobile shell | Capacitor 6 (Android) — thin native wrapper, WebView points at Railway |
| Health Connect | `@kiwi-health/capacitor-health-connect` v0.0.40 |
| PWA | Custom service worker v4 (NetworkFirst nav, CacheFirst static, eager clone) |
| Tests | Vitest (coach FSM, Health Connect matcher, classifier, tracker math, i18n parity, …) |
| Deploy | Railway (single service, auto-deploy from `main`) |

---

## App structure

### Bottom-nav tabs

| Tab | Route | Purpose |
|---|---|---|
| Home | `/home` | Greeting, today's plan card, recent workout list, **pending classifications card** (when external sessions need labelling), quick-log sheet |
| Roadmap | `/roadmap` | 2-week periodized plan; chronologically sorted; inline edit (title + date), reschedule, delete |
| Coach | `/coach` | Persistent AI chat; tool-driven proposals + immediate-apply classifySession |
| Analytics | `/analytics` | Per-category charts, daily activity chart, coach level, stat tiles |
| Settings | `/settings` (header gear) | Language, theme, multi-goal management, weight log, level override, Health Connect sync |

### Per-thread workout coach

Every workout log gets its own coach thread at `/coach/[workoutLogId]`. The general (workout-agnostic) thread lives at `/coach/general` and carries broader chat history.

---

## Coach algorithm

Pure functions in `lib/coach/index.ts`. No DB calls — caller supplies inputs, FSM returns new state and a session plan.

### FSM rules (priority order)

1. **Hard freeze** — `foot_pain ≥ 7` in last 7 days → recovery-only session.
2. **Soft freeze** — 7-day average `foot_pain ≥ 4` → no progression.
3. **Interval reduction** — last run flagged `breathing_dereg` or `form_breakdown` → interval blocks cut 25%.
4. **Manual override** — user-set level locks FSM for 7 days.
5. **Green session** — RPE ≤ 7 AND foot_pain ≤ 3 → increment green counter.
6. **Promotion** — 3 greens in a row → level +1, distance +20%.
7. **Goal-category branching** — strength: lift blocks with the dedicated `evaluateStrengthCoach`; weight_loss / body_shape: higher cardio frequency; running: interval + endurance sessions.
8. **External activity visibility** — when `fit_sessions` data is present, the FSM records a `external_activity_seen:<count>` rule entry so the audit log can tell whether the coach had visibility into non-AdaptiveFit training. The signal does NOT change plan outcomes (external sessions lack RPE/pain), but the chat coach uses it conversationally.
9. **Default** — repeat last week.

### Multi-discipline chat coach

The `coachChatTurn` Gemini prompt is a single qualified-sports-coach system that adapts to the modality at hand:

- **Running** — pace ranges, foot-pain trends, "green band" framing.
- **Strength** — sets × reps × load, RPE/RIR, exercise selection, progressive overload, plantar-fascia caution on loaded compounds.
- **Mobility** — region targeting, fascial work, breathing, how mobility unlocks next session.
- **Other** — light acknowledgement + ask what the modality was.

Every reply has access to the most recent external HC sessions with auto-classification labels (`labelled training`, `labelled activity`, `likely training`, `likely activity`, `AMBIGUOUS — please clarify`) and a HARD RULE: never tell the athlete "you haven't trained" when training-labelled sessions exist; never call short low-volume walks "training".

### Tools available to the chat coach

| Tool | Apply mode | Purpose |
|---|---|---|
| `proposeSoftenSession` | Pending (Approve/Decline card) | Reduce volume/intensity on a future planned session |
| `proposeSwapToRest` | Pending | Replace a session with rest/mobility |
| `proposeFreezeWeek` | Pending | Halt progression for N days |
| `proposeRecordSymptom` | Pending | Add a symptom to the workout being discussed |
| `proposeAddSession` | Pending | Add a new session on a future date |
| `classifySession` | **Immediate** | Persist the athlete's training/activity classification on an external HC session — no approval gate because the athlete IS the source of truth |

### Periodization (`lib/coach/periodize.ts`)

3-week build / 1-week deload cycle. When a goal target date is set:

- **Peak** (3 weeks out) — volume ×1.25, level +1
- **Taper** (final 2 weeks) — volume ×0.75, level −1
- **Deload** (every 4th week otherwise) — volume ×0.7
- **Build** weeks — volume scales ×1.0 → ×1.1 → ×1.2

### Roadmap generation (`lib/roadmap/regenerate.ts`)

Generates 2 weeks of `training_roadmap` rows (Tue + Fri per week). Reads 8 weeks of history, picks the primary goal by priority (running > weight_loss > body_shape > strength), applies periodization per week index, calls `evaluateCoach` for each slot. External activity from `fit_sessions` is passed through so the regen has the same visibility as the chat coach.

---

## Analytics

Charts branch by active goal category:

| Goal | Charts |
|---|---|
| Running | RPE × Pace / Distance × Pace toggle · Weekly distance bars |
| Weight loss | Weight trend line + target · Weekly cardio sessions |
| Body shape | Body composition (weight + body fat) · Weekly training volume |
| Strength | Lift progression (heaviest set per exercise per day) · Weekly session volume |
| **All** | Stat tiles · Coach level bar · Daily activity chart (active min + avg RPE, last 28 days) |

### Daily Activity chart — source merge rule

The "Active time" series combines two data sources keyed by Asia/Jerusalem calendar date:

1. `workout_logs.duration_sec` — what you logged in AdaptiveFit (in-app GPS runs + manual logs)
2. External `fit_sessions` durations — synced from Health Connect (Strava, Samsung Health, etc.)

**Merge rule (per day): prefer workout_logs when present, fall back to fit_sessions otherwise.** This prevents double-counting when the same run lives in both sources. External sessions classified as `clearly_activity` by the smart classifier OR `user_classification = 'activity'` are excluded entirely; ambiguous sessions stay hidden from the chart until the user labels them.

### Time-zone semantics

- **Week anchor:** Sunday, `Asia/Jerusalem` timezone.
- SQL: `DATE(performed_at AT TIME ZONE 'Asia/Jerusalem') - EXTRACT(DOW FROM ...)::int`
- JS: exact `YYYY-MM-DD` key matching via `lib/analytics/week.ts` helpers.
- `fit_sessions` are bucketed into the same Asia/Jerusalem day so the merge keys align cleanly with `workout_logs`.

---

## Database schema (key tables and columns)

| Table | Purpose |
|---|---|
| `users` | Single-user record, locale preference, display name |
| `goals` | Training goals — multiple active goals allowed, category-prioritized, target lifts JSONB for strength |
| `workout_logs` | Every logged session. `type` enum: `run \| strength \| mobility \| other`. Generated columns: `pace_sec_per_km`, `rtl` (RTL = distance × RPE/10 for runs, 0 otherwise) |
| `strength_logs` | Per-exercise lift records linked to a `workout_log`; exercise / weightKg / reps / sets / rpe |
| `feedback_sentiment` | Gemini-parsed session notes — overall_sentiment, symptoms[], bilingual ai_summary, extracted distance + duration |
| `user_level_state` | Coach FSM state — level, green count, freeze flags, manual override window |
| `training_roadmap` | Planned sessions stored as (weekIndex, dayIndex). `source` enum (`auto / manual / coach_proposal`) gates which rows the auto-regenerator may delete |
| `cold_start_analysis` | Gemini import of historical chat log |
| `body_metrics` | Daily weight / body-fat / waist measurements (unique per user + date) |
| `coach_chat_messages` + `coach_chat_actions` | Persistent coach conversation. Actions support `pending / approved / declined / reverted` with `reversal` JSON for undo |
| `run_sessions` + `gps_points` | Live GPS tracker data; client-side run id + status enum (`in_progress / completed`) for crash-safe resume |
| `oauth_tokens` | Legacy Google Fit OAuth tokens (Phase 3); HC supersedes |
| `fit_daily_metrics` | Per-day Health Connect aggregates (steps, distance, active_minutes, calories, avg_hr) |
| `fit_sessions` | Health Connect ExerciseSession records. Includes `source_app` (Strava / Samsung / Fit / etc.) and **`user_classification`** (`training / activity / null`) for the smart classifier ask-flow |

### Migrations

```
drizzle/
  0000_initial_baseline.sql
  0001_coach_chat_actions.sql
  0002_action_type_add_session.sql
  0003_run_session_partials.sql
  0004_fit_sessions_phase_8b.sql              -- source_app column for HC sessions
  0005_backfill_workout_run_metrics.sql
  0006_fit_sessions_user_classification.sql   -- user_classification + partial index
```

---

## Project layout

```
app/
  (app)/
    home/                          page.tsx, actions.ts (log + chat coach turn),
                                   sessionClassificationActions.ts (get pending / set classification)
    coach/                         persistent AI chat tab (general thread + per-workout threads)
    roadmap/                       periodized plan; data.ts sorts sessions by date
    analytics/                     goal-branched charts + daily activity
    settings/                      preferences, goals, weight log, HC sync
    workouts/                      legacy workout list (kept for edit/delete + history)
  (auth)/sign-in/
  api/
    auth/                          Auth.js handlers
    fit/                           legacy Google Fit OAuth + sync (kept for back-compat; HC is the live path)
    health/                        Railway health check

lib/
  analytics/                       week.ts — Sunday-anchor + Israel-timezone week helpers
  auth/                            Auth.js config
  body-metrics/                    logWeight, deleteWeightEntry server actions
  coach/
    index.ts                       FSM (running + strength branches)
    periodize.ts                   build / deload / peak / taper math
    coldStart.ts                   Gemini history importer
    chatTools.ts                   COACH_CHAT_TOOLS — Gemini function declarations
    externalActivity.ts            smart classifier + summarizers + per-session prompt formatter
  db/                              Drizzle client, schema.ts (single source of truth)
  fit/
    types.ts                       FitDailyAggregate, FitSessionSummary
    healthConnect.ts               plugin abstraction + buildPermissionResult + readDailyMetrics + readSessions
    syncFromClient.ts              client-side sync orchestrator
    deriveActiveMinutes.ts         per-day active-minutes derivation from session windows
  gemini/                          Gemini client, prompt modules, extractFeedback, summarizePostWorkout
  goals/                           saveGoal, archiveGoalById server actions
  hooks/                           useDraftWorkout (post-workout draft persistence), useWakeLock, …
  i18n/                            next-intl request config
  roadmap/                         regenerate.ts — full roadmap generation with external-activity visibility
  run/
    haversine.ts                   pure GPS math — haversineKm, isPointValid, computeSplits, windowedPace
    tracker.ts                     useRunTracker hook with crash-safe resume
    persistence.ts                 IDB snapshots
    nativeGeolocation.ts           foreground-service-aware GPS watcher
  utils/                           cn, date helpers
  workouts/                        update, delete, recompute server actions

components/
  analytics/                       VolumeChart · TrendChart · TrendChartCard (toggle)
                                   WeightTrendChart · LiftProgressChart · DailyActivityChart
  coach/                           ChatThread (renders messages + Approve/Decline cards) · ChatList
  coldstart/                       ColdStartReviewModal
  custom/                          BottomNav · ThemeGuard · HealthConnectAutoSync (foreground-sync glue)
  goals/                           GoalForm
  home/
    HomeClient.tsx                 client-side state machine
    PreWorkout.tsx                 today's plan card + greeting
    PostWorkout.tsx                quick-log sheet (type picker, run metrics, strength sheet, RPE, pain, notes, photo)
    PendingClassificationsCard.tsx amber card on Home for ambiguous external sessions
    ActiveRun.tsx · RunSummary.tsx GPS tracker UI
    Analyzing.tsx · DoneState.tsx  post-log states
  roadmap/                         RoadmapView · LevelOverrideSheet
  run/                             BackgroundLocationExplainer
  settings/                        BodyMetricsSection
  workouts/                        WorkoutList · LogWorkoutForm (deprecated, replaced by PostWorkout) ·
                                   EditWorkoutForm · RecentWorkoutsSheet

messages/
  en.json                          English UI strings
  he.json                          Hebrew UI strings

scripts/
  migrate.ts                       node-postgres migrator runner
  seed-history.ts                  seed realistic workout history for analytics testing

tests/
  coach/                           coach.test.ts · integration.test.ts · externalActivity.test.ts
  fit/                             healthConnect.test.ts · deriveActiveMinutes.test.ts · autoSyncThrottle.test.ts
  gemini/                          extractFeedback.test.ts · summarizePostWorkout.test.ts
  run/                             tracker.test.ts (haversine, isPointValid, computeSplits, windowedPace)
  i18n/                            rtl.test.ts (en/he parity + Hebrew character validation)

public/
  manifest.json                    PWA manifest
  sw.js                            Service worker v4 (NetworkFirst nav, CacheFirst static, eager .clone())
  icons/                           PWA icons
```

---

## Quick start (local)

```bash
pnpm install
cp .env.example .env        # fill in values (see below)
pnpm db:migrate             # apply all migrations to local Postgres
pnpm dev                    # http://localhost:3000
pnpm test                   # run all unit tests
```

### Required environment variables

```
DATABASE_URL=               # Postgres connection string
AUTH_SECRET=                # Auth.js secret — openssl rand -base64 32
AUTH_GOOGLE_ID=             # Google OAuth client ID
AUTH_GOOGLE_SECRET=         # Google OAuth client secret
ALLOWED_EMAIL=              # your email — only this address can sign in
GEMINI_API_KEY=             # Google AI Studio key
NEXT_PUBLIC_MAPBOX_TOKEN=   # Mapbox public token (for GPS map)
```

### Useful scripts

```bash
pnpm db:generate            # generate SQL from schema.ts changes
pnpm db:migrate             # apply migrations
pnpm db:studio              # Drizzle Studio — browse DB in browser
pnpm db:seed-history        # seed weeks of realistic workout history
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run
pnpm test:watch             # vitest watch mode
pnpm lint
```

---

## Deploy (Railway)

Railway auto-deploys from `main`. Build command (in `railway.toml`) runs `pnpm db:migrate` before `pnpm build`, so schema changes apply automatically on push.

```bash
git push origin main        # triggers Railway build + deploy
```

The Capacitor APK is a thin shell pointing at the Railway URL — client-side code changes ship via `git push`, NOT via APK rebuild. Only changes to `android/`, `capacitor.config.ts`, plugins, or `AndroidManifest.xml` require a fresh APK build.

---

## Mobile shell (Capacitor, Android)

The Android app is a thin Capacitor 6 native wrapper around the live web app — **no JS bundled into the APK**. The WebView points at Railway in production, or your laptop's LAN IP in dev mode. Background-capable GPS, Health Connect, and a foreground-service notification all live in this shell.

### Build the APK

```bash
pnpm cap:sync                  # syncs web config + plugins into android/
cd android
./gradlew assembleDebug        # outputs app/build/outputs/apk/debug/app-debug.apk
pnpm android:install-debug     # adb install -r the debug APK
```

### Dev mode (LAN URL)

Set `CAPACITOR_DEV=1` at sync time to point the WebView at your laptop's Next.js dev server instead of Railway. The default LAN URL is `http://10.0.0.20:3000` — override with `CAPACITOR_DEV_URL` if your IP differs.

```powershell
$env:CAPACITOR_DEV="1"; pnpm cap:sync   # PowerShell
# CAPACITOR_DEV=1 pnpm cap:sync          # bash/zsh
```

### Why we force Kotlin 2.2.10

`android/app/build.gradle` has a `resolutionStrategy.force` block pinning kotlin-stdlib to 2.2.10. The kiwi-health Health Connect plugin's compiled bytecode references `kotlin.coroutines.jvm.internal.SpillingKt`, which **only exists in Kotlin 2.x stdlib JARs** (verified by scanning the Gradle JAR cache). Without the force, AGP picks up an older 1.x stdlib transitively and the first suspending plugin call crashes with `NoClassDefFoundError`.

### proguard-android.txt → -optimize.txt

AGP 9.2.1 rejected the legacy `proguard-android.txt` because it disables R8 optimization passes (`-dontoptimize`). Every Capacitor plugin still references it. Rather than patching `node_modules/` (and re-patching on every `pnpm install`), `android/proguard-fix.gradle` is applied from `android/build.gradle` — at evaluation time it rewrites every subproject's proguard config to use `proguard-android-optimize.txt` instead. Idempotent, survives reinstalls.

### Health Connect

Android-only, on-device, **no cloud OAuth**. The native shell calls the kiwi-health plugin which reads from the Health Connect app on the device, then POSTs to a server action which upserts into `fit_daily_metrics` and `fit_sessions`. Same tables the old Google Fit REST path used → analytics & home widget keep working unchanged.

**What we read:**

| Type | Used for | Notes |
|---|---|---|
| Steps | Daily aggregate + per-session scoping | Required permission |
| Distance | Daily aggregate + per-session distance | Required permission |
| ActiveCaloriesBurned | Daily aggregate + per-session calories | Required permission |
| TotalCaloriesBurned | Daily aggregate | Required permission |
| ExerciseSession | External workouts from Strava / Samsung Health / Google Fit / Fitbit / etc. — feeds `fit_sessions` with `source_app` for provenance | Required permission (`READ_EXERCISE` in manifest) |
| HeartRate | Deferred — kiwi-health plugin's `RecordTypeRegistry` doesn't include it yet; needs fork | Not requested |

**Permission resolution:** `lib/fit/healthConnect.ts:buildPermissionResult` reads `hasAllPermissions: boolean` directly from the plugin response — the authoritative signal documented in the plugin's TypeScript types — and falls back to a normalize-and-substring matcher only when the boolean is absent. Earlier matcher-only logic (Phase 8b.1) reported false negatives on the "no requestable permission in the request" path; the boolean-first approach fixed it.

**Manifest:** every HC permission must be statically declared in `android/app/src/main/AndroidManifest.xml`. Adding a new HC type to the plugin's read set without also adding the corresponding `<uses-permission android:name="android.permission.health.READ_*" />` line silently no-ops at runtime (HC's permission Activity returns "No requestable permission in the request").

**Sync triggers:**

- **Auto on foreground** — `components/custom/HealthConnectAutoSync.tsx` mounted at the `(app)` layout fires on `document.visibilitychange` (5-min cooldown, localStorage-throttled). Silent — failures swallow to console.
- **Manual** — **Settings → Health Connect → Sync now** with proper UI feedback (specific missing-perms message when partial denial).

**Smart training/activity classifier for external sessions** — every ExerciseSession lands in one of three buckets via `lib/coach/externalActivity.ts:classifySessionSmart`:

| Bucket | Rule | Effect |
|---|---|---|
| `clearly_training` | pace < 8 min/km · OR distance ≥ 8 km · OR duration ≥ 90 min · OR Strava + ≥20 min + ≥2 km | Counts on chart, fed to FSM, chat coach treats as training |
| `clearly_activity` | duration < 15 min · OR (pace > 14 min/km AND distance < 5 km) · OR (no distance + duration < 30 min + not Strava) | Excluded from chart, chat coach calls it "a walk" |
| `ambiguous` | everything else (brisk walks, mid-length casual jogs, hikes) | Excluded from chart UNTIL the user labels it; surfaces on Home card + chat coach prompts about it |

The user's classification (`fit_sessions.user_classification`) overrides the auto bucket. Either resolution path — the Home `PendingClassificationsCard` (thumbs-up/down) or the chat coach's `classifySession` tool — writes to the same column.

**Active-minutes derivation** — Health Connect doesn't expose an "active minutes" aggregate. `lib/fit/deriveActiveMinutes.ts:deriveActiveMinutesByDay` sums the duration of every ExerciseSession overlapping each UTC day (sessions spanning midnight are split). The result populates `fit_daily_metrics.active_minutes` on every sync.

**Ground-truth rule.** For daily aggregates Health Connect is the single source of truth. AdaptiveFit stores per-workout detail (RPE, foot-pain, pace, notes) in `workout_logs` — those are AF-owned. The Daily Activity chart merges both via the "prefer workout_logs over fit_sessions per day" rule documented above. See `BACKLOG.md` for the deferred AF→HC write-back that would unify both into a single record set.

### Google OAuth user-agent override

Google's "Use secure browsers" policy blocks the default Android WebView UA (`; wv` suffix) with `disallowed_useragent`. `capacitor.config.ts` sets `overrideUserAgent` to a plain Chrome string so OAuth completes. **Not Play-Store-policy compliant** — fine for a sideloaded single-user app. If we ever publish on Play, swap for Chrome Custom Tabs + deep-link.

If you have Google's Advanced Protection Program enabled, OAuth in a WebView is blocked regardless of UA — temporarily disable APP at <https://myaccount.google.com/advanced-protection>.

---

## Tests

```bash
pnpm test                   # run everything
```

Coverage today:

| Suite | What it pins |
|---|---|
| `tests/coach/coach.test.ts` | FSM rules (hard freeze, soft freeze, promotion, default) + external-activity data path invariants (plan-outcome doesn't change on external visibility) |
| `tests/coach/integration.test.ts` | End-to-end FSM + roadmap-regen integration |
| `tests/coach/externalActivity.test.ts` | `classifySessionSmart` rules table (training band, activity band, ambiguous band, boundaries) + summarize + format helpers |
| `tests/fit/healthConnect.test.ts` | Permission-string normalizer + `buildPermissionResult` boolean-first logic + ExerciseSession alias matching |
| `tests/fit/deriveActiveMinutes.test.ts` | Active-minutes derivation, midnight splits, multi-day sessions, sub-30s rounding |
| `tests/fit/autoSyncThrottle.test.ts` | 5-min foreground-sync cooldown predicate |
| `tests/gemini/extractFeedback.test.ts` | Output schema validation (sentiment, symptoms, distance/duration back-fill bounds) |
| `tests/gemini/summarizePostWorkout.test.ts` | Output schema + WorkoutType union exhaustiveness |
| `tests/run/tracker.test.ts` | Haversine math, `isPointValid` boundaries, `computeSplits` float-drift-safe boundary detection, `windowedPace` |
| `tests/i18n/rtl.test.ts` | en/he key parity + Hebrew character validation on critical strings |

---

## Service worker (v4)

`public/sw.js` strategy:

- `_next/static/**` — CacheFirst, long-lived (Next.js hashes filenames so cache is implicitly versioned)
- `/manifest.json` — CacheFirst precache
- `/api/`, auth routes, cross-origin — NetworkOnly (skip SW)
- Everything else — NetworkFirst with cache fallback

**v4 change:** the NetworkFirst branch now clones the response **eagerly** before kicking off the async `caches.open(...).then((cache) => cache.put(req, resClone))` chain. The previous code called `res.clone()` inside the deferred `.then()` — by the time the deferred chain ran, the browser had already started consuming the response body, and the deferred clone threw `Failed to execute 'clone' on 'Response': Response body is already used` on every navigation. Cache names bumped (`af-shell-v4`, `af-static-v3`) so the new SW activates cleanly and evicts the buggy v3 caches.

---

## Rotate the Gemini key

If the key was ever pasted in chat, a screenshot, or a commit, rotate immediately:

1. <https://aistudio.google.com/app/apikey> → delete the old key
2. Create a fresh key
3. Update in `.env` locally and in Railway → Variables
4. Never paste it in chat again

---

## License

Private. Personal app.
