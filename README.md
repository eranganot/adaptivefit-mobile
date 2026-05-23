# AdaptiveFit Mobile

Personal AI running & multi-sport coach. Single-user PWA for Pixel 9 on Android.  
Built with Next.js 15 · Drizzle/Postgres · Gemini · Railway.

---

## What it does

AdaptiveFit is a self-hosted coaching app that replaces a Gemini chat workflow with a structured, data-driven training loop:

- **Logs every workout** (run, strength, mobility, other) with RPE, foot-pain score, distance, duration, and free-text notes
- **Parses notes with Gemini** to extract structured sentiment (breathing, form, mood, pain signals)
- **Runs a conservative coach FSM** that adjusts the weekly session plan based on recent load, pain signals, goal category, and periodization phase
- **Generates a 4-week periodized training roadmap** with taper/peak/deload phases tied to a goal target date — inline editable/reschedulable from the Roadmap tab
- **Tracks four goal categories** (running, weight loss, body composition, strength) with per-category analytics and coaching logic
- **Logs body weight** over time with a dedicated weight-log UI in Settings
- **Reads daily Health Connect aggregates** (steps, distance, calories) on Android via the native Capacitor shell — on-device, no cloud OAuth
- **Tracks live GPS runs** with a Mapbox map and real-time pace overlays
- **Shows analytics** per goal category — weekly distance, RPE × pace trends, lift progression, weight trend, daily active-time × effort chart
- **Bilingual UI** — English (LTR) and Hebrew (RTL), switchable per user
- **PWA** — installable on Android, offline shell via service worker

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, server actions, server components) |
| Database | PostgreSQL via Railway plugin |
| ORM | Drizzle ORM (typed queries, `db:push` schema migrations) |
| Auth | Auth.js v5 — Google OAuth, single-email allowlist |
| AI | Gemini (`gemini-1.5-flash` for extraction; `gemini-1.5-pro` for cold-start import) |
| Maps | Mapbox GL JS (live GPS run tracker) |
| Charts | Recharts (ComposedChart, BarChart, LineChart) |
| i18n | next-intl (EN / HE) |
| UI | Tailwind CSS + shadcn/ui primitives |
| PWA | next-pwa + custom service worker (NetworkFirst nav, CacheFirst static, v3) |
| Tests | Vitest (coach FSM unit tests) |
| Deploy | Railway (single service, auto-deploy from `main`) |

---

## App structure

### Bottom-nav tabs

| Tab | Route | Purpose |
|---|---|---|
| Home | `/home` | Next session card, coach-level badge, recent workout list, quick-log sheet |
| Workouts | `/workouts` | Full workout log — add, edit, delete; live GPS tracker for runs |
| Roadmap | `/roadmap` | 4-week periodized plan; inline edit (title + date), reschedule, delete |
| Analytics | `/analytics` | Per-category charts, daily activity chart, coach level bar, stat tiles |
| Settings | `/settings` | Language, theme, multi-goal management, weight log, Training Level override, Health Connect sync |

### Coach tab (floating)

Persistent AI chat with session-aware tool calls (log workout, reschedule session, summarize history).

---

## Coach algorithm

Pure functions in `lib/coach/index.ts`. No DB calls — caller supplies inputs, FSM returns new state and a session plan.

**Rules (priority order):**

1. **Hard freeze** — `foot_pain ≥ 7` in last 7 days → recovery-only session
2. **Soft freeze** — 7-day average `foot_pain ≥ 4` → no progression
3. **Interval reduction** — last run flagged `breathing_dereg` or `form_breakdown` → interval blocks cut 25%
4. **Manual override** — user-set level locks FSM for 7 days
5. **Green session** — RPE ≤ 7 AND foot_pain ≤ 3 → increment green counter
6. **Promotion** — 3 greens in a row → level +1, distance +20%
7. **Goal-category branching** — strength: prescribes lift blocks; weight_loss/body_shape: higher cardio frequency; running: interval + endurance sessions
8. **Default** — repeat last week

**Periodization** (`lib/coach/periodize.ts`):

3-week build / 1-week deload cycle. When a goal target date is set:

- **Peak** (3 weeks out) — volume ×1.25, level +1
- **Taper** (final 2 weeks) — volume ×0.75, level −1
- **Deload** (every 4th week otherwise) — volume ×0.7
- **Build** weeks — volume scales ×1.0 → ×1.1 → ×1.2

**Roadmap generation** (`lib/roadmap/regenerate.ts`):  
Generates 4 weeks of `training_roadmap` rows (Tue + Fri per week). Reads 8 weeks of history, picks the primary goal by priority (running > weight_loss > body_shape > strength), applies periodization per week index, calls `evaluateCoach` for each slot.

---

## Analytics

Charts branch by active goal category:

| Goal | Charts |
|---|---|
| Running | RPE × Pace / Distance × Pace toggle · Weekly distance bars |
| Weight loss | Weight trend line + target · Weekly cardio sessions |
| Body shape | Body composition (weight + body fat) · Weekly training volume |
| Strength | Lift progression (heaviest set per exercise per day) · Weekly session volume |
| **All** | Stat tiles · Coach level bar · Daily activity chart (active min + avg RPE, last 14 days) |

**Week anchor:** Sunday, `Asia/Jerusalem` timezone.  
SQL: `DATE(performed_at AT TIME ZONE 'Asia/Jerusalem') - EXTRACT(DOW FROM ...)::int`  
JS: exact `YYYY-MM-DD` key matching via `lib/analytics/week.ts` helpers.

---

## Database schema (key tables)

| Table | Purpose |
|---|---|
| `users` | Single-user record, locale preference |
| `goals` | Training goals — multiple active goals allowed, category-prioritized |
| `workout_logs` | Every logged session; generated columns: `pace_sec_per_km`, `rtl` |
| `feedback_sentiment` | Gemini-parsed session notes |
| `user_level_state` | Coach FSM state — level, green count, freeze flags, manual override |
| `training_roadmap` | Planned sessions stored as (weekIndex, dayIndex) from current Monday |
| `cold_start_analysis` | Gemini import of historical chat log |
| `strength_logs` | Per-exercise lift records linked to a `workout_log` |
| `body_metrics` | Daily weight / body-fat / waist measurements (unique per user + date) |
| `coach_chat_messages` + `coach_chat_actions` | Persistent coach conversation |
| `run_sessions` + `gps_points` | Live GPS tracker data |
| `oauth_tokens` | Google Fit OAuth tokens |
| `fit_daily_metrics` + `fit_sessions` | Synced Google Fit step counts and activities |

---

## Project layout

```
app/
  (app)/
    home/           next session card, quick-log sheet
    workouts/       workout list, log form, GPS tracker
    roadmap/        periodized plan, inline edit/reschedule/delete
    analytics/      goal-branched charts + daily activity
    coach/          persistent AI chat tab
    settings/       preferences, goals, weight log, Fit
  (auth)/signin/
  api/
    auth/           Auth.js handlers
    coach/          Gemini chat endpoint
    fit/            Google Fit OAuth + sync
    goals/
    import/         cold-start Gemini import
    workouts/
    health/         Railway health check

lib/
  analytics/        week.ts — Sunday-anchor + Israel-timezone week helpers
  auth/             Auth.js config
  body-metrics/     logWeight + deleteWeightEntry server actions
  coach/            index.ts (FSM) · periodize.ts · coldStart.ts · chatTools.ts
  db/               Drizzle client · schema.ts · relations.ts
  fit/              Google Fit OAuth + sync logic
  gemini/           Gemini client, prompt modules, extraction helpers
  goals/            saveGoal, archiveGoalById server actions
  hooks/            useGPS, useWakeLock
  i18n/             next-intl request config
  roadmap/          regenerate.ts — full roadmap generation
  run/              GPS + pace computation helpers
  utils/            cn, date helpers
  workouts/         log, edit, delete server actions

components/
  analytics/        VolumeChart · TrendChart · TrendChartCard (toggle)
                    WeightTrendChart · LiftProgressChart · DailyActivityChart
  coach/            ChatThread · ChatInput
  coldstart/        ColdStartReviewModal
  custom/           BottomNav · ThemeGuard
  goals/            GoalForm
  home/             NextSessionCard · QuickLogSheet
  roadmap/          RoadmapView · RoadmapHeader
  run/              MapboxLiveMap · PaceDisplay
  settings/         BodyMetricsSection
  workouts/         WorkoutList · WorkoutForm · WorkoutEditSheet

messages/
  en.json           English UI strings
  he.json           Hebrew UI strings

scripts/
  migrate.ts        node-postgres migrator runner
  seed.ts           dev seed data
  seed-history.ts   seed 12-week workout history for analytics testing

tests/coach/        Vitest specs for FSM rules

public/
  manifest.json     PWA manifest
  sw.js             Service worker (NetworkFirst nav, CacheFirst static, v3)
```

---

## Quick start (local)

```bash
pnpm install
cp .env.example .env        # fill in values (see below)
pnpm db:push                # push schema to local Postgres
pnpm dev                    # http://localhost:3000
pnpm test                   # run coach FSM unit tests
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
pnpm db:studio              # Drizzle Studio — browse DB in browser
pnpm db:seed-history        # seed 12 weeks of realistic workout history
pnpm typecheck              # tsc --noEmit
pnpm lint
```

---

## Deploy (Railway)

Railway auto-deploys from `main`. No additional config beyond environment variables.

```bash
git push origin main        # triggers Railway build + deploy
```

Schema changes: run `pnpm db:push` pointed at the Railway `DATABASE_URL`, or execute DDL directly in the Railway SQL console.

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

Android-only, on-device, **no cloud OAuth**. The native shell calls the kiwi-health plugin which reads daily aggregates from the Health Connect app on the device, then POSTs them to a server action which upserts into `fit_daily_metrics`. Same table the old Google Fit REST path used → analytics & home widget keep working unchanged.

Requirements:
- Health Connect app installed on the device (pre-installed on Android 14+, manual install on older).
- User has granted READ permissions for Steps, Distance, ActiveCaloriesBurned, TotalCaloriesBurned. HeartRate is deferred (the plugin's RecordTypeRegistry doesn't include it yet).
- The presence of `fit_daily_metrics` rows for the user is the "connected" signal — there's no oauth_tokens row anymore.

Sync triggers:
- **Auto** — every time the app comes to the foreground (throttled to once per 5 min). Implemented in `components/custom/HealthConnectAutoSync.tsx`, mounted at the `(app)` layout. Uses `document.visibilitychange` so it works in both the native shell and a regular browser tab. Silent — failures swallow to the console.
- **Manual** — **Settings → Health Connect → Sync now** is the user-visible escape hatch with proper UI feedback.

**Ground-truth rule.** For daily aggregates (steps, distance, active minutes, calories) Health Connect is the single source of truth. AdaptiveFit stores per-workout detail (RPE, foot-pain, pace, notes) in `workout_logs` — those are AF-owned and HC has nothing to say about them. The two datasets are kept side-by-side; **we do not combine values**. If HC and a workout_logs row disagree about distance for the same day, the displayed daily-aggregate tile reflects HC; the workout_logs row stays untouched and continues to drive RPE/pace charts. See `BACKLOG.md` for the deferred AF→HC write-back that would unify both into a single record set.

### Google OAuth user-agent override

Google's "Use secure browsers" policy blocks the default Android WebView UA (`; wv` suffix) with `disallowed_useragent`. `capacitor.config.ts` sets `overrideUserAgent` to a plain Chrome string so OAuth completes. **Not Play-Store-policy compliant** — fine for a sideloaded single-user app. If we ever publish on Play, swap for Chrome Custom Tabs + deep-link.

If you have Google's Advanced Protection Program enabled, OAuth in a WebView is blocked regardless of UA — temporarily disable APP at <https://myaccount.google.com/advanced-protection>.

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
