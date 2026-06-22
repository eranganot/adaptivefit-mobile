# AdaptiveFit — Status

_Last updated: 2026-06-22 by Claude (session "review tasks / optimize")._
_Seeded from git history + prior session transcripts; confirm the "Next" items reflect your current intent._

## Now (deployed & live on main)
- Multi-thread coach: general chat + per-workout debrief threads, with per-thread rename + delete (3-dot menu).
- Coach on Gemini 2.5 Pro with retry/backoff, summarizer pre-step, real-error surfacing.
- Smart training/activity classifier + ask-flow (Home card + chat `classifySession` tool); auto-classify of AF-overlapping fit_sessions.
- Analytics dual-axis charts (volume+pace, training-load+foot-pain); RPE×Pace / Dist×Pace toggles.
- Roadmap collapses same-day duplicates; a logged workout suppresses the rest-day card.
- Workout reminder notifications + Sunday week start.
- New app icon (activity rings + AI spark) — HEAD `dd07577`.

## ⚠️ Uncommitted (as of this snapshot)
Working tree is dirty: `.env.example`, `DEPLOY.md`, `analytics/data.ts`, android icon files, `.eslintrc.json`, `.gitignore`, `.prettierrc.json`, `ADAPTIVEFIT_EXECUTION_PLAN.md`, gradlew.bat. Decide whether to commit or discard before the next deploy.

## Next (from ADAPTIVEFIT_EXECUTION_PLAN.md — confirm priority)
1. **Phase 2** — Mapbox live run tracking: `useRunTracker` hook, wakeLock, run-summary with pace splits.
2. **Phase 3** — Google Fit OAuth (read-only), nightly aggregate sync via Railway cron, cold-start Gemini analysis.

## Pending QA
- The multi-thread coach rename/delete checklist (migration 0007, legacy URL redirects, rename persistence, delete-then-recreate). Mark verified once run on the Pixel 9.

## Known sharp edges
See CLAUDE.md — `.next` cache after route renames, sandbox can't push. (Repo now on `C:\dev\` — OneDrive lock failures retired.)

## Changelog (newest first)
- 2026-06-22 — Repo moved off OneDrive to `C:\dev\adaptivefit-mobile`; typecheck + lint green on new path.
- 2026-06-22 — STATUS.md + CLAUDE.md seeded.
- (prior) — app icon, coach rename/delete, multi-thread coach refactor (0007), smart classifier, Gemini 2.5 Pro coach.
