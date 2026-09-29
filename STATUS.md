# AdaptiveFit — Status

_Last updated: 2026-09-28 by Claude (weekly status review — sandbox DOWN; git state read from `.git/logs/HEAD` only, working tree NOT checked)._
_Seeded from git history + prior session transcripts; confirm the "Next" items reflect your current intent._

## Now (deployed & live on main)
- Multi-thread coach: general chat + per-workout debrief threads, with per-thread rename + delete (3-dot menu).
- Coach on Gemini 2.5 Pro with retry/backoff, summarizer pre-step, real-error surfacing.
- Smart training/activity classifier + ask-flow (Home card + chat `classifySession` tool); auto-classify of AF-overlapping fit_sessions.
- Analytics dual-axis charts (volume+pace, training-load+foot-pain); RPE×Pace / Dist×Pace toggles.
- Roadmap collapses same-day duplicates; a logged workout suppresses the rest-day card.
- Workout reminder notifications + Sunday week start.
- New app icon (activity rings + AI spark). HEAD `f4c17a8` (deploy-verify on the C:\dev path; **no new feature commits since 2026-06-22 — 14 weeks**).

## Next (from ADAPTIVEFIT_EXECUTION_PLAN.md — confirm priority)
1. **Phase 2** — Mapbox live run tracking: `useRunTracker` hook, wakeLock, run-summary with pace splits.
2. **Phase 3** — Google Fit OAuth (read-only), nightly aggregate sync via Railway cron, cold-start Gemini analysis.

## 🔴 Ops actions (Eran only) — with age
_Dates are when the item was FIRST flagged, and are carried forward, never reset. Anything open >2 weeks is BLOCKING._

| first flagged | age | item |
|---|---|---|
| 2026-07-20 | **10 weeks — BLOCKING** | 🔴 **Phase 2 / Phase 3 are a dead "Next".** Ten consecutive reviews, zero commits behind them, repo silent 14 weeks. **Park it in one sentence in this file, or put a commit behind Phase 2.** The other two rows are downstream of this answer. |
| 2026-06-22 | **14 weeks — BLOCKING** | 🔴 **Multi-thread coach QA has never been run** (migration 0007, legacy URL redirects, rename persistence, delete-then-recreate). Run it on the Pixel 9, or delete the claim from "Now". |
| 2026-08-17 | **6 weeks — BLOCKING** | Uncommitted `.gitignore` (+7 lines: `.claude/`, `_to_delete/`). _Not re-checked 09-28 (sandbox down, no `git status`)._ Commit or discard. |

## Pending QA
- The multi-thread coach rename/delete checklist — **see Ops actions, 14 weeks unrun.**

## Known sharp edges
See CLAUDE.md — `.next` cache after route renames, sandbox can't push. (Repo now on `C:\dev\` — OneDrive lock failures retired.)

## Changelog (newest first)

- 2026-09-29 — **Coach leaked tool calls as text (fixed).** Symptom: chat bubble showed `tool_code / print(default_api.…)` + a `thought` section; next turn applied cards Eran never saw explained, and the swap card said only "an upcoming session" so he declined it. **Root cause (PROVEN, Railway logs):** 10:16:57 `gemini-2.5-flash` replyLength 1564, functionCallCount 0, so the calls came back as text. We saved and rendered `response.text()` raw and replayed it as a model history turn. 10:49:43: replyLength 0, 3 real calls (classifySession, proposeSwapToRest, proposeAddSession) with card reasons copied word for word from the leak. **Ruled out:** our code building the text (no `tool_code` string in repo); turn-2 calls being new decisions (reasons verbatim from turn 1). **Why silent:** API call succeeded; `functionCallCount:0` looks like a normal text reply. **Fix:** `lib/coach/leakedToolCalls.ts` detects the leak, salvages `default_api.x(...)` into real function calls the same turn, and drops the text (tool-only fallback reply is used). Leaked rows are masked in history replay + chat display. Prompt forbids text-form tools/reasoning. swap/soften cards now name the session (`sessionLabel` stamped from the roadmap row). "New plan" requests now point to Roadmap → Regenerate (no chat tool for that). The log line now has `leaked` + `salvagedCount`; watch for `"leaked":true`. Tests: `tests/coach/leakedToolCalls.test.ts` (prod text as fixture).
- 2026-09-28 — Weekly status review, **sandbox down** (workspace VM failed to mount; Windows update issue). Git read from `.git/logs/HEAD` without running git: **no commits since 2026-06-22 — 14 weeks quiet.** Working tree could NOT be checked. ✅ **The `.git/index.lock` left by the 09-21 run is gone** — Eran cleared it; closed. Ops ages bumped (coach QA 14w, Phase 2/3 10w, `.gitignore` 6w); nothing closed, nothing added. The park-or-build decision is still the only line anything else depends on.
- 2026-08-31→09-21 (collapsed) — Four weekly reviews, repo quiet throughout, tree unchanged (`.gitignore` + STATUS.md). 09-14 and 09-21 runs each left a `.git/index.lock` via plain `git status`; both cleared by Eran. Permanent rule: weekly runs use `git --no-optional-locks` from the very first call.
- 2026-07-20→08-25 (collapsed) — Weekly reviews: repo quiet since 2026-06-22; 87-file CRLF noise cleared 07-20; aged Ops table introduced 08-17; Phase 2/3 promoted to its top 08-25.
- 2026-06-22 — Repo moved off OneDrive to `C:\dev\adaptivefit-mobile`; typecheck + lint green on new path. STATUS.md + CLAUDE.md seeded.
- (prior) — app icon, coach rename/delete, multi-thread coach refactor (0007), smart classifier, Gemini 2.5 Pro coach.
