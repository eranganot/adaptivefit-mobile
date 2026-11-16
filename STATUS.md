# AdaptiveFit — Status

_Last updated: 2026-11-16 by Claude (weekly status review; `origin/main` = `5cf1ca6` (PR #12 Railway IaC, merged 2026-11-16); the Mac checkout is on `fix/af-8-railway-iac` at `4dd22fe`, 13 commits behind `origin/main`; git read with `--no-optional-locks`)._
_Seeded from git history + prior session transcripts; confirm the "Next" items reflect your current intent._

## Now (deployed & live on main)
- **GPS run flow (plan Phase 2, `3e23f4e` 2026-05-02):** Start Run → live Mapbox map → pause/resume → End Run → run summary → coach feedback; IndexedDB persistence + 15 s server sync + Capacitor background-geolocation foreground service (`7e6099c`, 05-18).
- **Health data (plan Phase 3, done differently):** Google Fit OAuth shipped 05-02 (`31b2e93`) and was replaced by **Health Connect** (Phase 8/8b, 05-18 → 05-24): daily aggregates, ExerciseSession reads, foreground auto-sync. No nightly server cron — sync runs when the app opens.
- Multi-thread coach: general chat + per-workout debrief threads, with per-thread rename + delete (3-dot menu).
- Coach on Gemini 2.5 Pro with retry/backoff, summarizer pre-step, real-error surfacing.
- Smart training/activity classifier + ask-flow (Home card + chat `classifySession` tool); auto-classify of AF-overlapping fit_sessions.
- Analytics dual-axis charts (volume+pace, training-load+foot-pain); RPE×Pace / Dist×Pace toggles.
- Roadmap collapses same-day duplicates; a logged workout suppresses the rest-day card.
- Workout reminder notifications + Sunday week start.
- New app icon (activity rings + AI spark). HEAD `cec9413` (2026-09-29): **three coach fix commits since 09-28 — the first code in 14 weeks** (`7b93fc2` leaked-tool-call salvage, `bcc5eae` cards-without-remount / regen skips occupied days / newest-40 history, `cec9413` `proposeReplaceSession`, migration 0008). All three are **pending QA on the Pixel** — see below; no Phase 2/3 work.

- **Coach QA PASSED 2026-10-05 (Eran, Pixel):** multi-thread coach + 09-29 batch — `proposeReplaceSession` (replace card, not rest), cards appear without leaving the thread, Regenerate skips occupied days, history shows newest 40, leaked tool-call text salvaged. Migration 0008 live.

- **Deploy settings are infrastructure as code (2026-11-09, merged 2026-11-16 as PR #12):** `.railway/railway.ts` holds NIXPACKS + frozen pnpm build, `pnpm start`, `pnpm db:migrate` pre-deploy, `/api/health` 120 s, 3 restarts; `railway.toml` removed ahead of Railway's 2026-12-01 cutoff. Also 11-09: gradlew executable/LF, Dependabot minor/patch only. **Verified live 2026-11-16:** prod `/api/health` 200 on `5cf1ca6`.

## Next (confirm priority)
_The execution plan's Phase 1/2/3 shipped in May 2026 (see "Now"); its `- [ ]` boxes are stale (BACKLOG.md says so since 2026-06-21). The live backlog is BACKLOG.md "Active backlog":_
1. AF → Health Connect write-back (ExerciseSession).
2. Chrome Custom Tabs for OAuth (only needed for Play Store).
3. HeartRate from Health Connect (needs a kiwi-health plugin fork).
4. Real-time HC content-change listener (Android 14+ foreground service).
5. Profile avatar menu + sign-out.
6. Native voice-to-text for workout notes.

## 🔴 Ops actions (Eran only) — with age
_Dates are when the item was FIRST flagged, and are carried forward, never reset. Anything open >2 weeks is BLOCKING._

| first flagged | age | item |
|---|---|---|
| 2026-07-20 | **CLOSED 2026-11-16 — it was never open** | ✅ Phase 2 (GPS run, `3e23f4e` 2026-05-02) and Phase 3 (Google Fit `31b2e93` 05-02, superseded by Health Connect `9a43339` 05-18) shipped before this file was seeded on 06-22; the seed copied the plan's unchecked boxes as "Next". Its verify-by (`git log --grep Phase`) was never run for 17 weeks. _Original row:_ 🔴 **Phase 2 / Phase 3 are a dead "Next".** Seventeen weeks of reviews, zero Phase 2/3 commits behind them (the 09-29 commits were coach fixes). **Park it in one sentence in this file, or put a commit behind Phase 2.** The other two rows are downstream of this answer. |
| 2026-11-02 | **CLOSED 2026-11-16 — fixed locally, push pending** | ✅ The WIP's CLAUDE.md + .gitignore changes and this file were committed on `chore/af-mac-migration` (from `origin/main`); push it and merge. _Original row:_ ⚠️ **The PC→Mac migration WIP was never sorted out** _(2026-11-16: still not on `origin/main`; the Mac checkout is now on `fix/af-8-railway-iac` at `4dd22fe`, 13 behind `origin/main`, with this file's review edits uncommitted)_. Was: HEAD is `4dd22fe` "wip: back up uncommitted work before PC to Mac migration" (2026-10-18) on branch `wip/pc-migration-2026-10-18` (pushed); `main` is still `cec9413`. The commit is docs-only (`.gitignore`, `CLAUDE.md`, `STATUS.md`). Fast-forward `main` to it and switch back, or drop the branch. Verify by: `git --no-optional-locks -C ~/Dev/adaptivefit-mobile rev-parse --abbrev-ref HEAD` prints `main`. |
| 2026-06-22 | **CLOSED 2026-10-05 — QA passed** | ✅ Eran ran the coach QA on the Pixel and it passed (reported 2026-10-05): multi-thread coach plus the 09-29 fixes (replace-session card, cards without remount, regenerate respects occupied days, newest-40 history, rename/delete). Moved to "Now". |
| 2026-08-17 | **CLOSED 2026-10-05** | ✅ `.gitignore` is tracked and the working tree is clean (verified with `git --no-optional-locks status`). |

## Pending QA
- None open. The 09-29 coach batch and the multi-thread rename/delete checklist passed on 2026-10-05 (see Now).
- Open inference, not QA: a multi-step coach turn may stop after step 1 (needs the `coachChatTurn response` log line: functionCallCount + finishReason).

## Known sharp edges
See CLAUDE.md — `.next` cache after route renames, sandbox can't push. (Repo now on the Mac at `~/Dev/adaptivefit-mobile` since 2026-10; the Windows PC is retired.)
- **`railway config apply` deletes everything the file does not list in the LINKED project.** On 2026-11-15 this repo's `railway.ts` was applied while linked to WealthOS and deleted its web/worker services (rebuilt, see Family-Office `f981710`). Run `railway status` and check the project name before every apply.

## Changelog (newest first)

- 2026-11-16 — Weekly status review. `origin/main` moved: Railway IaC (`.railway/railway.ts`, `railway.toml` gone; PR #12 merged 11-16), gradlew LF, Dependabot config; prod health 200 on `5cf1ca6`. No STATUS commit since 09-29 — the 11-02 review edits here are still uncommitted. Ops: Phase 2/3 row CLOSED — it shipped in May (stale seed, see table); migration WIP fixed on `chore/af-mac-migration`. Now/Next rewritten from git + BACKLOG.md. Pruned: 09-28/09-29 entries moved to STATUS-ARCHIVE.md.

- 2026-11-02 — Weekly status review (now on the Mac). No commits since 2026-10-18 (`4dd22fe`, migration WIP, docs-only, on a `wip/` branch; `main` = `cec9413`). Tree clean. Ops: Phase 2/3 → 15 weeks; new row for the unmerged migration WIP branch. Pending QA cleared (passed 10-05). Pruned: entries 09-21 and older moved to STATUS-ARCHIVE.md.

- 2026-10-12 — Weekly status review. No commits since 09-29 (`cec9413`). Phase 2/3 decision still unanswered (12 weeks). Nothing pruned (all entries < 6 weeks except the collapsed 06-22 row).

- 2026-10-05 (later) — Eran: coach QA passed; Phase 2/3 plan under his review.

- 2026-10-05 — Weekly status review. Git read with `--no-optional-locks`; tree clean, no lock left. 3 coach commits on 09-29 were already logged below; "Now" HEAD line and header corrected (they still said "no commits since 06-22"). `.gitignore` row closed. Coach QA now 15 weeks unrun; Phase 2/3 now 11 weeks.
