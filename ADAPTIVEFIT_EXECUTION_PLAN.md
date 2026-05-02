# AdaptiveFit — Execution Plan

**Owner:** Eran Ganot
**Drafted:** 2026-04-28
**Status:** Plan locked. Awaiting kickoff on Phase 1.

This document is the single source of truth for closing the gap between the current Next.js scaffold (`adaptivefit-mobile/`) and the design canvas Eran approved in the Make/Lovable session (`uploads/UI Design Suggestions for AdaptiveFit-723ed88f.make`, 312-message conversation, final approval `"looks great!!!"`).

---

## 0 · Decisions locked on 2026-04-28

| # | Decision | Choice |
|---|----------|--------|
| 1 | Tab structure | **3 tabs**: Home / Roadmap / Analytics. Goals move to Settings. `/workouts` and `/goals` routes deleted. |
| 2 | Google Fit sync | **Read-only**, full daily aggregates: steps, distance, heart rate, active minutes, workout sessions with route polyline. No write-back. |
| 3 | Map provider | **Mapbox GL** (free tier sufficient at single-user scale). |
| 4 | Phasing | **Three waves**: P1 manual-log MVP → P2 GPS active-run → P3 Google Fit sync. Each wave ships a working app. |

---

## 1 · Per-page breakdown (design source-of-truth)

The reconstructed design source lives at `outputs/design_recon/src/app/`. Each section below lists **Features**, **Design**, and **Functionality** — that's the contract every page must hit.

### 1.1 Shell — `Layout` (header + bottom nav)

**Features**
- App-wide chrome: header with logo + settings + profile, 3-tab bottom nav with active indicator, page-transition animations.
- RTL-aware: nav and animation directions flip when locale = `he`.

**Design**
- Header (h-16): blue 8×8 rounded square with white "AF" italic, app title beside it, gear icon (→ `/settings`), avatar circle.
- Header is sticky, white/80 + backdrop-blur. Border-bottom on scroll.
- Bottom nav (h-20): three tabs evenly spaced, icon (24×24) + label (10px). Active tab = `text-blue-600` + small dot indicator below the icon (animated `layoutId` from Motion).
- Page wrapper: `max-w-md` mobile-first column, slate-50 / dark slate-950 main area.
- Page transitions: `AnimatePresence` with horizontal slide, direction respects RTL.

**Functionality**
- Active tab derived from `usePathname()`.
- Settings click → router push to `/settings`.
- Profile circle is inert (cosmetic placeholder) for MVP; future: dropdown with sign-out.
- The `pb-safe` utility plus `env(safe-area-inset-bottom)` handles iOS/Android home bar.

**Gap vs current build**
- Current `BottomNav` has 4 tabs, no animated indicator, no header element. Header is currently just a plain `app/(app)/layout.tsx` server component with no visual chrome.

---

### 1.2 Home — `pre-workout` state

**Features**
- Personalised greeting + today's plan summary.
- Coach Insight gradient card (purple→indigo) with one-sentence rationale.
- Detailed workout steps timeline (warm-up / main / cool-down) — each step has number badge, title, duration chip, description.
- Two big action buttons: **Start Run** (GPS, primary) and **Log Manual** (secondary).

**Design**
- Greeting: `text-2xl font-bold tracking-tight`, subtitle = today's plan title.
- Insight card: `bg-gradient-to-br from-indigo-500 to-purple-600`, sparkles icon in circle, body text with key noun highlighted via inline `bg-white/20` chip.
- Workout steps: vertical timeline with a thin connecting line. Each step block has a coloured circular number badge (4-px white border) + title + duration chip + 1-line description.
- Action grid: 2-col grid, each tile is rounded-3xl, primary tile has `shadow-blue-600/20`, contains 12×12 icon circle + label + tiny subtitle.

**Functionality**
- Greeting derived from local hour (Morning/Afternoon/Evening) + `session.user.name?.split(" ")[0]`.
- Today's plan = output of the coach FSM (`evaluateCoach({recentLogs, state, today})` already in `lib/coach/index.ts`).
- Workout steps = derived from `todayPlan.blocks` (warmup/main/mobility/rest); render each block as a step.
- Start Run → push to in-memory state `active-run` (P2; in P1 disabled or hidden behind feature flag).
- Log Manual → push to state `post-workout`.
- If a workout was already logged today, replace both buttons with the existing "✓ Already logged" pill + Gemini summary line.

**Gap vs current build**
- Current Home renders one boring card and a `Link` to `/workouts`. Missing insight card, workout-steps timeline, action grid, and the post-log "already logged" state already partly exists but visually doesn't match.

---

### 1.3 Home — `active-run` state (Phase 2)

**Features**
- Phase header showing current step ("Step 2 of 3 — Easy Pace Run").
- Live GPS map with route polyline + pulsing current-location dot + GPS signal strength chip.
- Big tabular timer (`mm:ss`).
- 4-tile metric grid: Avg Pace, Heart Rate, Distance, Steps.
- Pause/Resume button + End Run (rose-600 destructive).

**Design**
- Map: 64-tall rounded-3xl with overlay grid + faint road lines + blue route polyline. Current-location dot pulses when running, freezes when paused.
- Timer: `text-6xl font-black tabular-nums`, blue glow halo when running, slate halo when paused.
- Metric tiles: 2-col, each tile has icon (top, coloured) + tabular-nums value + uppercase 10px label. Heart icon pulses.
- Bottom controls: Pause is square left, End Run takes 2/3 width, both `py-5` chunky.

**Functionality**
- Geolocation: `navigator.geolocation.watchPosition({enableHighAccuracy:true})`, polled at 1Hz with debounce + Kalman-style smoothing for noise.
- Timer: client-side `setInterval(1000)` + `secondsElapsed` state; pause toggles a `isPaused` ref.
- Distance: cumulative haversine over consecutive GPS points (filter by `accuracy < 25m`); pace = elapsedSec / distanceKm running average (last 30s).
- HR / steps: pulled from Web Bluetooth (HR strap) if present, else from Google Fit live sync if available, else "—".
- Route polyline drawn on Mapbox GL with `addSource(line) + addLayer({type:'line'})`, updated on each GPS tick.
- Pause stops the timer interval and the distance calc but keeps GPS watcher alive (so we know when paused-and-walking happens).
- End Run → flush to `runSessions` table, transition to `run-summary`.

**Gap vs current build**
- Doesn't exist at all. New screen, new GPS plumbing, new schema (`run_sessions`, `gps_points`).

---

### 1.4 Home — `run-summary` state (Phase 2)

**Features**
- Recap header ("Workout Complete").
- Map snapshot of completed route.
- Stats row: Distance / Time / Avg Pace.
- Pace splits per kilometre with horizontal bar visualization.
- "Get Coach Feedback" button → `post-workout` state.

**Design**
- Map snapshot: same 40-tall version of active-run map, no live elements; replace pulsing dot with finish flag.
- Stats row: 3-col `divide-x` grid inside the map card, each cell stacks value + tiny uppercase label.
- Pace splits section: 5 rows (one per km), each with km label + pace + relative-pace bar (length proportional to pace, faster = longer).
- Final CTA: blue-600 primary `py-4 rounded-2xl`.

**Functionality**
- Pace splits = window over GPS points binned by distance (every 1 km). Compute split pace = (timeSec at end of km) − (timeSec at start of km).
- Bar widths scale to fastest split = 100%.
- "Get Coach Feedback" pre-fills the post-workout form with the run's RPE estimate (HR-based proxy or default 5) and pre-attaches the run-session id.

**Gap**
- Doesn't exist.

---

### 1.5 Home — `post-workout` state (Coach Feedback)

**Features**
- Coach intro bubble (indigo card with brain icon + sentence + RPE quick-pick chips).
- Pain Yes/No (segmented control).
- Notes textarea (free text, EN/HE auto-detect).
- Optional photo upload (e.g., shoe tread, swelling).
- Submit button (disabled until RPE + pain answered).
- Cancel pill back to `pre-workout`.

**Design**
- Coach bubble: indigo-50 bg, brain icon in 10×10 circle, body sentence + 4 RPE chips (Easy 1-3 / Moderate 4-6 / Hard 7-9 / Max 10). Selected chip flips to indigo-600 solid.
- Pain segmented: 2 buttons side-by-side, "No Issues" with Check icon goes emerald, "Yes, Pain" with Frown icon goes rose.
- Notes section: 24-tall textarea + a full-width "Upload Photo" button below; button switches to "Image Attached" + check when a file is chosen.
- Submit: blue-600 `py-4 rounded-2xl` with shadow.

**Functionality**
- RPE chip → numeric RPE bucket midpoint (Easy=2, Moderate=5, Hard=8, Max=10).
- Pain Yes → set `footPain` field in form; for MVP we treat any "Yes" as `footPain=6` (above coach freeze threshold) with a follow-up in P3 to ask "where".
- Notes → server action POSTs `/api/workouts` (existing endpoint), Gemini extracts sentiment+symptoms (`extractFeedback.ts` already exists).
- Photo: stored in Postgres `bytea` for MVP (single user, low volume); Phase 3 moves to Cloudflare R2 if Eran wants gallery.
- Submit → optimistic `analyzing` state, await server response, then route to `done`.

**Gap**
- Most of this exists in `components/workouts/LogWorkoutForm.tsx` but with totally different UX (form fields not chips). Needs a redesign + state-machine integration.

---

### 1.6 Home — `analyzing` state

**Features**
- Loading interlude while Gemini runs sentiment + coach re-evaluation.

**Design**
- Centered 20×20 brain icon inside a pulsing blue ring (animate-ping outer + animate-pulse inner). Caption "Coach is analyzing your session…"

**Functionality**
- Pure presentational; backed by an `await` on the server-action promise.
- Soft minimum 1.5s display (avoid flash) using `Promise.all([action(), wait(1500)])`.

---

### 1.7 Home — `done` state (AI Coach response)

**Features**
- "Coach AI · Session Analysis" header with brain avatar.
- Coach analysis paragraph (3–4 sentences).
- Bulleted "Coach's Adjustments" list of concrete plan changes.
- Two buttons: **Back to Home** (slate-100 secondary) and **Continue conversation** (slate-900 primary). Latter swaps the buttons for a chat input.
- Chat input: rounded-full pill, send button on right, autofocus on appear.

**Design**
- Header: brain icon in blue-600 circle with 4px blue-100 ring, title + subtitle stacked.
- Analysis card: white rounded-3xl with paragraph + nested slate-50 inner card titled "Coach's Adjustments".
- Adjustments list: bullets with tiny blue dot, each adjustment one sentence.
- Buttons: 2-col grid, equal width.

**Functionality**
- Analysis text + adjustments come from a Gemini call: `summarizePostWorkout({rpe, pain, notes, recentLogs, currentLevel})` returning `{summary, adjustments[]}`.
- "Back to Home" resets the state machine and clears form.
- "Continue conversation" opens the chat input. Each sent message → append to `coach_chat_messages` table + Gemini turn-based completion. (P1 limit: 10 turns per session.)

**Gap**
- Doesn't exist; needs new Gemini prompt + new chat schema.

---

### 1.8 Roadmap tab

**Features**
- Header with section title ("Upcoming Schedule" / "לוח זמנים קרוב") + "This Week" subtitle + Week badge ("Week 4 / 12").
- Vertical timeline of N upcoming session cards, each showing date, title, status icon, exercise list, optional "Adjusted" note.
- Visual states: completed (green check, line-through, opacity-70), adjusted (orange alert + orange-tinted card + orange note), planned (slate circle).

**Design**
- Header right-aligned blue pill with week count.
- Vertical line down the left (RTL: right) of the column.
- Each card: status icon offsets the line, then white rounded-2xl card with: small uppercase date + status pill, title, vertical bullet list of exercise steps, and orange info banner if adjusted.

**Functionality**
- Data source: `training_roadmap` table, filtered by current `goal_id`, ordered by week_index + day_index, limited to next 14 days from today.
- Status auto-derived: rows with `performedAt < today` AND a matching `workout_logs` row → completed; rows with `status='modified'` → adjusted; otherwise planned.
- Coach FSM regenerates roadmap rows whenever (a) RPE/pain breach a threshold, (b) cold-start runs, (c) user completes a level promotion. Server action: `regenerateRoadmap(userId)`.
- Manual Level Override (per the original brief): kebab menu on Week badge → bottom sheet to pick level 1-10. Lands in `user_level_state.currentLevel` and triggers regeneration.

**Gap**
- Doesn't exist as a tab; `training_roadmap` table exists but no generator and no UI.

---

### 1.9 Analytics tab

**Features**
- Header: title + subtitle ("Correlation between perceived effort and actual pace.")
- Two stat tiles: Weekly Distance + Avg RPE, with trend chips (↑ / ↓ / "Ideal").
- Dual-axis line chart: RPE (left axis, blue) vs Pace (right axis, red).
- Bar chart: Weekly Distance over last 4 weeks.

**Design**
- Stat tiles: 2-col grid, white rounded-3xl, value `text-2xl font-bold`, trend chip is rounded-full with directional icon + percentage.
- Line chart: Recharts `LineChart` with two `<Line>` series, dotted grid, no axis lines, soft 12px tooltip with rounded-corner card.
- Bar chart: Recharts `BarChart`, emerald-500 bars with `radius=[4,4,0,0]`.
- Section spacing: each chart in its own white rounded-3xl shadow-sm card.

**Functionality**
- Aggregations: `weekly_distance` = SUM(distance_km) WHERE performedAt in current ISO week. `avg_rpe` = AVG(rpe) over last 7 days.
- Line chart points: last 7 days, one row per day (gaps left as null so Recharts renders broken line, not zero).
- "Adjusted for terrain" pace from the original brief: when notes contain `incline|hills|הר|עליה`, multiply pace by 0.95 (forgive). Hook lives in coach algo already; just plumb to chart.
- Trend chips: compare current period to previous period of same length. If `weekly_distance` < 80% of previous → orange "−45%". If `avg_rpe` between 4 and 7 → green "Ideal".
- Tap a tile → bottom sheet with detailed breakdown (P3 polish, not P1).

**Gap**
- Two charts already exist (`TrendChart`, `VolumeChart`) but they need restyling to match the design (rounded cards, custom tooltips, dual-axis line). Stat tiles are missing.

---

### 1.10 Settings tab

**Features**
- Language picker: EN / HE with LTR / RTL hint subtitle.
- Theme picker: Light / Dark.
- **Goals section** (moved here per the locked decision): Active goal card + edit button.
- **Connections** (Phase 3): Google Fit connect/disconnect, last-sync timestamp, manual "Sync now" button.
- About / sign-out at the bottom.

**Design**
- Each section is a white rounded-3xl card with a title header (icon + label) and inner padded list.
- Selected language shown with blue check; selected theme shown with amber border + amber-50 fill.
- Goal card: shows target (e.g., "5k under 25:00 by Sept 1, 2026"), status pill, edit pencil.

**Functionality**
- Language change → update `users.locale`, set `locale` cookie, hard reload (since next-intl is server-resolved).
- Theme: write to `localStorage` + toggle the `dark` class on `<html>`. (Persistence-only client side.)
- Goal edit → modal with the existing GoalForm component.
- Phase 3: Connect Google Fit → POST `/api/auth/google-fit` → OAuth dance → store refresh token in `oauth_tokens` table.

**Gap**
- Existing settings doesn't exist as a route at all; only a gear icon nowhere wired up. Goal management is on its own tab today; needs to be moved.

---

### 1.11 Onboarding (new — implied but not in canvas)

The Make canvas skipped onboarding (assumes a logged-in user with an active goal). For real users we need:

1. **Sign-in screen** — Google OAuth button. Locked to `ALLOWED_EMAIL`.
2. **First-goal wizard** — 2 steps: pick goal type (5k time / weekly volume / sessions/week / custom) + target value + target date.
3. **Connect Google Fit** (Phase 3 only) — explanatory copy + Connect button + skip option.
4. **Cold-start analysis** (Phase 3) — if Fit connected: analyse last 14 days → Gemini-recommended starting Level → user accepts / overrides.
5. **Land on Home** — first run state appears with the placeholder workout plan from the coach FSM.

Steps 1–2 ship in Phase 1. Steps 3–4 ship in Phase 3. The cold-start analysis already has scaffolding in `cold_start_analysis` table and `seed-history.ts` script.

---

## 2 · Schema deltas

Current schema (in `lib/db/schema.ts`) covers `users`, `goals`, `workout_logs`, `feedback_sentiment`, `user_level_state`, `training_roadmap`, `cold_start_analysis`. Additions needed:

### Phase 1 additions
```sql
-- Photos uploaded with workout feedback
CREATE TABLE workout_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_log_id UUID NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  mime_type   TEXT NOT NULL,
  bytes       BYTEA NOT NULL,                   -- single-user, MVP-OK
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Coach chat continuation (after "done" state)
CREATE TABLE coach_chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_log_id UUID REFERENCES workout_logs(id) ON DELETE SET NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  locale        TEXT CHECK (locale IN ('en','he')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX coach_chat_user_workout_idx
  ON coach_chat_messages(user_id, workout_log_id, created_at);
```

### Phase 2 additions
```sql
-- Each Start Run → End Run produces one row
CREATE TABLE run_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_log_id UUID UNIQUE REFERENCES workout_logs(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL,
  distance_km   NUMERIC(6,3) NOT NULL,
  duration_sec  INTEGER NOT NULL,
  avg_pace_sec_per_km INTEGER NOT NULL,
  splits        JSONB NOT NULL,                  -- [{km:1, paceSec:330}, ...]
  source        TEXT NOT NULL DEFAULT 'gps' CHECK (source IN ('gps','manual','fit')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw GPS trail. We store every accepted point so we can re-compute splits later.
CREATE TABLE gps_points (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_session_id UUID NOT NULL REFERENCES run_sessions(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  accuracy_m    NUMERIC(6,2),
  altitude_m    NUMERIC(7,2),
  heart_rate    INTEGER,
  steps_delta   INTEGER
);
CREATE INDEX gps_points_session_ts_idx ON gps_points(run_session_id, ts);
```

### Phase 3 additions
```sql
-- One row per provider per user
CREATE TABLE oauth_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google_fit')),
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  scopes        TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Daily aggregates pulled from Fit
CREATE TABLE fit_daily_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  steps           INTEGER,
  distance_m      INTEGER,
  active_minutes  INTEGER,
  avg_heart_rate  NUMERIC(5,2),
  resting_heart_rate NUMERIC(5,2),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, day)
);

-- Workout sessions imported from Fit (separate from manual run_sessions)
CREATE TABLE fit_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fit_session_id TEXT NOT NULL,                 -- Fit's stable ID
  activity_type INTEGER NOT NULL,               -- Fit activity code (8 = running)
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL,
  distance_m    INTEGER,
  duration_sec  INTEGER,
  avg_heart_rate NUMERIC(5,2),
  route_polyline TEXT,                          -- Encoded polyline (lat,lon pairs)
  raw           JSONB NOT NULL,                 -- Original Fit payload
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, fit_session_id)
);
```

---

## 3 · Phase 1 — Manual-log MVP (3 working days)

**Goal:** Match the design 1:1 except for GPS active-run and Fit sync. App is fully usable for runners who log workouts manually after the run.

### Day 1 — Nav + scaffolding
- [ ] Delete `app/(app)/workouts/` and `app/(app)/goals/` directories.
- [ ] Add `app/(app)/roadmap/page.tsx` (empty stub).
- [ ] Update `BottomNav.tsx`: 3 tabs (Home / Roadmap / Analytics), animated indicator using `framer-motion` `layoutId`.
- [ ] Build `app/(app)/layout.tsx` shell with the design's header (logo + settings + avatar) and bottom-nav slot.
- [ ] Add `app/(app)/settings/page.tsx` with stub sections: Language, Theme, Goals, Connections.
- [ ] Move `GoalForm` from old goals tab into a `<GoalsSection>` component inside Settings.
- [ ] Add `motion/react` (or keep `framer-motion`) for page transitions.
- [ ] Migrate translations into `messages/en.json` and `messages/he.json` to cover every new copy snippet.
- [ ] Generate Drizzle migration for `workout_photos` + `coach_chat_messages` tables.

### Day 2 — Home pre-workout + post-workout state machine
- [ ] Convert `app/(app)/home/page.tsx` into a server-component shell that loads coach state + today's plan, then mounts a `<HomeClient>` client component holding the state machine.
- [ ] `<HomeClient>` state union: `pre-workout | post-workout | analyzing | done`. (P2 will add `active-run` and `run-summary`.)
- [ ] Build pre-workout sub-component: greeting, Insight card (gradient, sparkles icon, dynamic copy from coach), workout-steps timeline (mapped from `todayPlan.blocks`), action grid.
- [ ] Build post-workout sub-component: indigo coach bubble + RPE chips, pain segmented control, notes textarea + photo upload, submit.
- [ ] Wire submit to a server action `logManualWorkout(formData)` that:
  1. Inserts `workout_logs`.
  2. Inserts photo into `workout_photos` if present.
  3. Calls Gemini `extractFeedback`.
  4. Calls Gemini `summarizePostWorkout` → returns `{summary, adjustments[]}`.
  5. Returns DTO for the `done` view.
- [ ] Build `analyzing` view (brain icon spinner) and `done` view (coach analysis card + adjustments + Back/Continue conversation buttons).
- [ ] Build the chat continuation: `coachChatTurn(message, workoutLogId)` server action; persist to `coach_chat_messages`; cap 10 turns.

### Day 3 — Roadmap + Analytics + Settings polish
- [ ] Build `<RoadmapView>`: query `training_roadmap` joined with `workout_logs` to derive status. Render the timeline cards with status icons, exercise list, and orange "Adjusted" banner.
- [ ] Add `regenerateRoadmap()` server action triggered from coach FSM whenever it freezes/promotes/reduces.
- [ ] Build Analytics: keep existing `TrendChart`/`VolumeChart` but wrap in design's white rounded-3xl cards with the new section headers, add the two stat tiles + trend chips at the top.
- [ ] Restyle line chart to dual-axis (RPE left, Pace right), red/blue, custom tooltip.
- [ ] Settings: language picker calls server action that flips `users.locale`, sets cookie, redirects. Theme toggle persists in localStorage.
- [ ] RTL pass: open Hebrew, walk every screen, fix any ms-/me- regressions and timeline-line position bugs.
- [ ] PWA polish: confirm `manifest.json` + service worker (none yet — add minimal Workbox precache for offline shell).
- [ ] Vitest: add coach-chat unit tests, post-workout flow integration test, RTL snapshot test.

### Phase 1 Acceptance
- Sign in → Home → see today's plan with insight + steps timeline + 2 buttons (Start Run disabled with "Coming soon" tooltip).
- Tap Log Manual → fill RPE + pain + notes, optionally a photo → submit → loading → coach response with adjustments → Back to Home.
- Roadmap shows 14 days of upcoming sessions with correct status badges; the workout I just logged is marked completed.
- Analytics shows 7-day RPE/Pace line + 4-week distance bars + trend tiles.
- Toggle Hebrew in Settings → entire app flips RTL with translated copy.
- All on Pixel 9 PWA install.

---

## 4 · Phase 2 — GPS active-run (2 working days)

**Goal:** Tap Start Run → live tracking → End Run → review summary → hand off to coach feedback. No Fit dependency yet.

### Phase 1 gaps (carry-forward — complete before Day 4 work)
- [ ] Wire `regenerateRoadmap()` call inside `logManualWorkout` server action — invoke after coach FSM evaluates and produces a freeze or level promotion, so the roadmap refreshes automatically post-workout.
- [ ] Delete `/workouts` and `/goals` route directories entirely (currently they are redirect stubs — remove the directories so no dead routes exist in the build).
- [ ] Vitest: add post-workout flow integration test (logManualWorkout happy path + freeze path) and RTL snapshot tests for Home, Roadmap, and Analytics pages.

### Day 4 — GPS plumbing + active-run UI
- [ ] Install `mapbox-gl@^3` + `@types/mapbox-gl`. Add `NEXT_PUBLIC_MAPBOX_TOKEN` to `.env`/Railway.
- [ ] Build `lib/run/tracker.ts`:
  - `useRunTracker()` hook returning `{ status, startedAt, distanceKm, paceSecPerKm, secondsElapsed, currentPosition, route[], pause(), resume(), end() }`.
  - Geolocation `watchPosition` with `enableHighAccuracy:true`, `maximumAge:1000`.
  - Filter out points with accuracy > 25 m or velocity > 8 m/s (sprint sanity check).
  - Cumulative haversine distance + 30-s windowed pace.
- [ ] Add `<MapboxLiveMap>` component: shows route polyline that updates on each GPS tick, pulsing dot at currentPosition.
- [ ] Build `active-run` sub-component matching the design exactly (phase header, map, big timer, 4-tile metric grid, pause+end controls).
- [ ] Wire Start Run from pre-workout → flips state to `active-run` and starts tracker.
- [ ] HR placeholder: render "—" until P3 (Fit live HR) lands.
- [ ] Steps placeholder: same.

### Day 5 — Run summary + persistence + integration
- [ ] On End Run: server action `endRunSession({startedAt, endedAt, points[]})` → creates `run_sessions` + bulk-inserts `gps_points`, returns DTO with computed splits.
- [ ] Build `run-summary` sub-component: map snapshot using `mapbox-gl/style-spec` static-image API or render a static `<MapboxMap>` snapshot, stats row, pace splits with bar widths, "Get Coach Feedback" CTA.
- [ ] Hand-off: tapping "Get Coach Feedback" stores the run-session-id in form state, transitions to `post-workout`, pre-fills RPE estimate (cardiac drift heuristic if HR available; default Moderate otherwise) + distance + duration.
- [ ] Submit in post-workout now also links the existing `run_session.workout_log_id`.
- [ ] Add a battery-saver modal that prompts the user to disable battery optimisation on Pixel 9 if we detect `screen.wakeLock` is unsupported.
- [ ] Wake lock during active-run via `navigator.wakeLock.request('screen')`.
- [ ] Vitest: `tracker.ts` haversine tests, split-binning tests.
- [ ] Manual test: 1 km loop in real life, validate distance, splits, polyline.

### Phase 2 Acceptance
- Tap Start Run → 2-second loading → live map appears with my position → I run 1 km → distance + pace update in real-time → I pause → metrics freeze → resume → continue → End Run → summary screen with 1-km split → tap Get Coach Feedback → flows into the same coach feedback form pre-filled with run data.

---

## 5 · Phase 3 — Google Fit sync (2 working days)

**Goal:** Background read-only sync from Google Fit + cold-start analysis on first connect.

### Day 6 — OAuth + token storage
- [ ] Add Google Cloud project APIs: enable **Fitness API**.
- [ ] Add OAuth scopes (read-only):
  - `fitness.activity.read`
  - `fitness.location.read`
  - `fitness.heart_rate.read`
  - `fitness.body.read` (for steps)
  - `fitness.sleep.read` (optional, ignore for MVP)
- [ ] Build `app/api/auth/google-fit/route.ts` (start OAuth) and `app/api/auth/google-fit/callback/route.ts` (exchange code → store in `oauth_tokens`).
- [ ] Build `lib/fit/client.ts`:
  - `getFitClient(userId)` that handles refresh-token rotation transparently.
  - `aggregateDaily({startDate, endDate})` → daily steps/distance/HR/active-min via `users.dataset:aggregate`.
  - `listSessions({startDate, endDate})` + `getSessionDetail(id)` for sessions including route polylines.
- [ ] Build `app/api/fit/sync/route.ts` POST endpoint that:
  - Pulls last 30 days of daily aggregates → upserts into `fit_daily_metrics`.
  - Pulls sessions in window → upserts into `fit_sessions`.
  - Returns sync summary `{daysFetched, sessionsFetched}`.
- [ ] Add Settings → Connections section UI: connect button, last-sync timestamp, "Sync now" button, disconnect (revokes token + deletes row).

### Day 7 — Cold-start + surfacing Fit data + nightly cron
- [ ] Build cold-start: on first successful sync, run `lib/coach/coldStart.ts`:
  - Pull last 14 days of `fit_daily_metrics` + `fit_sessions`.
  - Pass to Gemini with prompt "based on this data, recommend a starting Level (1-10) for a conservative running plan, considering distance volume, HR consistency, and pain-flags free."
  - Store in `cold_start_analysis`. Pre-fill `user_level_state.currentLevel`. Show user the recommendation with accept/override.
- [ ] Surface Fit data on Home: pre-workout shows yesterday's steps + active minutes as a small stat strip ("Yesterday: 8,420 steps · 32 active min").
- [ ] Surface Fit on Analytics: add a third tile "Daily Steps (7d avg)" using `fit_daily_metrics`.
- [ ] During active-run: if a Fit HR data source is currently broadcasting (Wear OS pairing), poll latest HR every 5 s and display in the metric tile.
- [ ] Nightly cron job (Railway cron service): `POST /api/fit/sync` for every user with a connected Fit token, run at 03:00 user-local time.
- [ ] Background sync resilience: on failure (revoked token, network error), set `oauth_tokens.status='error'`, surface a banner in Settings.
- [ ] Final manual test: connect Fit → cold-start runs → I get recommended Level → I accept → next pre-workout reflects new plan.

### Phase 3 Acceptance
- Settings → Connect Google Fit → OAuth dance → land back on Settings with green check + "Connected (last synced 2s ago)".
- Cold-start modal shows "Based on your last 14 days, I recommend starting at Level 4." → I accept.
- Home pre-workout shows yesterday's step + active-min strip.
- Analytics shows Steps tile.
- Tomorrow morning, nightly cron has refreshed the daily aggregates without manual intervention.

---

## 6 · Risks and open questions

| # | Risk / question | Mitigation |
|---|-----------------|-----------|
| 1 | PWA geolocation is unreliable in background on Pixel 9 (Chrome throttles it). | Use `wakeLock` + recommend keeping the app foregrounded. Fall back to "screen-on" reminder modal. Long-term: native Android wrapper via Trusted Web Activity (TWA). |
| 2 | Mapbox free tier limit (50k loads/month) is plenty for single-user but watch the cron job — don't render maps server-side. | Static-image snapshots only on demand (run-summary), not on every render. |
| 3 | Photo storage in Postgres `bytea` will bloat the DB if Eran logs many photos. | OK for MVP. Migrate to Cloudflare R2 in P3 if photo count > 50. |
| 4 | Google Fit token revocation → silent sync failure. | Detect 401 in `getFitClient`, mark token row as errored, surface banner in Settings. |
| 5 | Cold-start Gemini hallucination → wrong starting Level recommendation. | Always require explicit user accept; never auto-apply. Cache the prompt+response in `cold_start_analysis` for audit. |
| 6 | RTL regressions on the timeline vertical line + Motion `x` animation directions. | Build a Vitest snapshot suite covering both locales for every page. |
| 7 | The design's `useState`-only model loses the post-workout draft if the user navigates away. | Persist draft to `localStorage` keyed by date; restore on Home mount. |
| 8 | Gemini billing — chat continuation could rack up tokens fast. | 10-turn cap per workout, plus `gemini-1.5-flash` (already configured) for chat instead of `pro`. |
| 9 | Manual Level Override conflicts with the conservative-coach FSM's progression rules. | Override sets a flag `manual_override=true` on `user_level_state`; coach respects it for the next 7 days then flag clears unless user re-overrides. |
| 10 | `framer-motion` vs `motion/react` — design uses the new `motion/react` package; `package.json` may not have it yet. | Verify on Day 1 and add either `motion` or stay on `framer-motion`. Both expose the same API surface for what we need. |

---

## 7 · Out of scope (intentional)

- Social features (sharing runs, friends, leaderboards). Single-user app.
- Wear OS app. PWA only on Pixel 9.
- Apple Health sync. Eran is on Pixel 9 → Google Fit only.
- Custom strength/mobility workouts beyond what the coach FSM emits.
- Voice-to-text for notes (was in original brief; deferred — Web Speech API is unreliable on PWA).
- Push notifications. We can add via Web Push in a future phase if Eran wants daily reminders.

---

## 8 · Definition of done — overall

- [ ] All 3 design tabs ship.
- [ ] Manual-log full flow ships (Phase 1).
- [ ] GPS Start Run → End Run → coach feedback ships (Phase 2).
- [ ] Google Fit read-only sync ships, including cold-start (Phase 3).
- [ ] Bilingual EN/HE with RTL works on every screen.
- [ ] PWA installable + offline shell on Pixel 9.
- [ ] Coach FSM unit-test suite green.
- [ ] No secrets in git; `.env` + Railway Variables only.
