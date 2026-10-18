# AdaptiveFit — Status

_Last updated: 2026-10-12 by Claude (weekly status review; HEAD `cec9413`, no commits since 2026-09-29; git read with `--no-optional-locks`)._
_Seeded from git history + prior session transcripts; confirm the "Next" items reflect your current intent._

## Now (deployed & live on main)
- Multi-thread coach: general chat + per-workout debrief threads, with per-thread rename + delete (3-dot menu).
- Coach on Gemini 2.5 Pro with retry/backoff, summarizer pre-step, real-error surfacing.
- Smart training/activity classifier + ask-flow (Home card + chat `classifySession` tool); auto-classify of AF-overlapping fit_sessions.
- Analytics dual-axis charts (volume+pace, training-load+foot-pain); RPE×Pace / Dist×Pace toggles.
- Roadmap collapses same-day duplicates; a logged workout suppresses the rest-day card.
- Workout reminder notifications + Sunday week start.
- New app icon (activity rings + AI spark). HEAD `cec9413` (2026-09-29): **three coach fix commits since 09-28 — the first code in 14 weeks** (`7b93fc2` leaked-tool-call salvage, `bcc5eae` cards-without-remount / regen skips occupied days / newest-40 history, `cec9413` `proposeReplaceSession`, migration 0008). All three are **pending QA on the Pixel** — see below; no Phase 2/3 work.

- **Coach QA PASSED 2026-10-05 (Eran, Pixel):** multi-thread coach + 09-29 batch — `proposeReplaceSession` (replace card, not rest), cards appear without leaving the thread, Regenerate skips occupied days, history shows newest 40, leaked tool-call text salvaged. Migration 0008 live.

## Next (from ADAPTIVEFIT_EXECUTION_PLAN.md — confirm priority)
1. **Phase 2/3 — UNDER REVIEW BY ERAN (2026-10-05); do not build until he answers.** Note: docs/PHASE_8B_HEALTH_CONNECT_FULL.md suggests Google Fit OAuth may be superseded by Health Connect.
1. **Phase 2** — Mapbox live run tracking: `useRunTracker` hook, wakeLock, run-summary with pace splits.
2. **Phase 3** — Google Fit OAuth (read-only), nightly aggregate sync via Railway cron, cold-start Gemini analysis.

## 🔴 Ops actions (Eran only) — with age
_Dates are when the item was FIRST flagged, and are carried forward, never reset. Anything open >2 weeks is BLOCKING._

| first flagged | age | item |
|---|---|---|
| 2026-07-20 | **12 weeks — BLOCKING** | 🔴 **Phase 2 / Phase 3 are a dead "Next".** Twelve consecutive reviews, zero Phase 2/3 commits behind them (the 09-29 commits were coach fixes). **Park it in one sentence in this file, or put a commit behind Phase 2.** The other two rows are downstream of this answer. |
| 2026-06-22 | **CLOSED 2026-10-05 — QA passed** | ✅ Eran ran the coach QA on the Pixel and it passed (reported 2026-10-05): multi-thread coach plus the 09-29 fixes (replace-session card, cards without remount, regenerate respects occupied days, newest-40 history, rename/delete). Moved to "Now". |
| 2026-08-17 | **CLOSED 2026-10-05** | ✅ `.gitignore` is tracked and the working tree is clean (verified with `git --no-optional-locks status`). |

## Pending QA
- _(2026-10-05: all items below PASSED — see Now.)_
- **09-29 coach batch (3 commits) — pending QA, not yet "Now":** leaked `tool_code` text gone; cards appear without leaving the thread; Regenerate does not re-add runs on a coach-owned day; "make today harder" yields a replace card, not a rest card. Open inference: multi-step turn may stop after step 1 (needs the `coachChatTurn response` log line).
- The multi-thread coach rename/delete checklist — **see Ops actions, 15 weeks unrun.**

## Known sharp edges
See CLAUDE.md — `.next` cache after route renames, sandbox can't push. (Repo now on `C:\dev\` — OneDrive lock failures retired.)

## Changelog (newest first)

- 2026-10-12 — Weekly status review. No commits since 09-29 (`cec9413`). Phase 2/3 decision still unanswered (12 weeks). Nothing pruned (all entries < 6 weeks except the collapsed 06-22 row).

- 2026-10-05 (later) — Eran: coach QA passed; Phase 2/3 plan under his review.

- 2026-10-05 — Weekly status review. Git read with `--no-optional-locks`; tree clean, no lock left. 3 coach commits on 09-29 were already logged below; "Now" HEAD line and header corrected (they still said "no commits since 06-22"). `.gitignore` row closed. Coach QA now 15 weeks unrun; Phase 2/3 now 11 weeks.

- 2026-09-29 (round 3) — **"Make today harder" produced a rest-day card (fixed).** Root cause (proven in code + the coach's own reply text): the tool set had no way to change a planned workout into a different one. The only removal tool was proposeSwapToRest, and the prompt taught "swapToRest + addSession" as the pattern. So the coach used rest as a delete step, and the card read as if it prescribed rest. Fix: new `proposeReplaceSession` → action `replace_session` (keeps the row and date, swaps run blocks, keeps warm-up/mobility/strength, fully revertible). swapToRest is now restricted to real rest. The prompt forbids rest-as-delete. The coach context now lists `modified` sessions too, so a changed session can be targeted again. Migration `0008_action_type_replace_session.sql`, and **0002 widened too**: every migration re-runs on each deploy, so 0002 re-adding a narrower CHECK would fail once a replace_session row exists. OPEN (INFERRED, not observed): the 11:4x reply said "two changes" but only one card appeared. Candidate: after its first function call Gemini waits for a functionResponse we never send, so a multi-step turn stops after step 1. Needs the `coachChatTurn response` log line for that turn: functionCallCount + finishReason.
- 2026-09-29 (round 2) — **Cards late + Regenerate re-adds runs (fixed).** (1) **Cards only appeared after leaving the thread.** Root cause (proven in code, observed by Eran): the new reply got the id `opt-reply-<ts>`, cards match by `chatMessageId === msg.id`, and `router.refresh()` synced actions but never messages. The code comment claiming "the optimistic message gets the real id" was false. Fix: `coachChatTurn` returns `messageId`; ChatThread uses it. (2) **Regenerate put a 5 × 600 back next to the coach-added Easy Return.** Root cause: regen deletes only pending `auto` rows, then wrote Tue/Fri sessions without checking whether a surviving row (manual / coach_proposal / completed / modified) already owned that day. It was silent because roadmap/data.ts collapses only rest-vs-real and same-title duplicates, not two different real sessions. Fix: `lib/roadmap/slots.ts` `withoutOccupiedSlots`, applied before insert. Tests in `tests/roadmap-slots.test.ts`. (3) Sibling: `getChatHistory` did ASC + LIMIT 40, which returned the OLDEST 40 messages, so long threads hid their newest turns. Now takes the newest 40, oldest-first. Suspected, NOT verified: week/day indices are computed relative to "this Sunday" both when written and when read, which would shift the dates of rows written in an earlier week. Check before trusting.
- 2026-09-29 — **Coach leaked tool calls as text (fixed).** Symptom: chat bubble showed `tool_code / print(default_api.…)` + a `thought` section; next turn applied cards Eran never saw explained, and the swap card said only "an upcoming session" so he declined it. **Root cause (PROVEN, Railway logs):** 10:16:57 `gemini-2.5-flash` replyLength 1564, functionCallCount 0, so the calls came back as text. We saved and rendered `response.text()` raw and replayed it as a model history turn. 10:49:43: replyLength 0, 3 real calls (classifySession, proposeSwapToRest, proposeAddSession) with card reasons copied word for word from the leak. **Ruled out:** our code building the text (no `tool_code` string in repo); turn-2 calls being new decisions (reasons verbatim from turn 1). **Why silent:** API call succeeded; `functionCallCount:0` looks like a normal text reply. **Fix:** `lib/coach/leakedToolCalls.ts` detects the leak, salvages `default_api.x(...)` into real function calls the same turn, and drops the text (tool-only fallback reply is used). Leaked rows are masked in history replay + chat display. Prompt forbids text-form tools/reasoning. swap/soften cards now name the session (`sessionLabel` stamped from the roadmap row). "New plan" requests now point to Roadmap → Regenerate (no chat tool for that). The log line now has `leaked` + `salvagedCount`; watch for `"leaked":true`. Tests: `tests/coach/leakedToolCalls.test.ts` (prod text as fixture).
- 2026-09-28 — Weekly status review, **sandbox down** (workspace VM failed to mount; Windows update issue). Git read from `.git/logs/HEAD` without running git: **no commits since 2026-06-22 — 14 weeks quiet.** Working tree could NOT be checked. ✅ **The `.git/index.lock` left by the 09-21 run is gone** — Eran cleared it; closed. Ops ages bumped (coach QA 14w, Phase 2/3 10w, `.gitignore` 6w); nothing closed, nothing added. The park-or-build decision is still the only line anything else depends on.
- 2026-08-31→09-21 (collapsed) — Four weekly reviews, repo quiet throughout, tree unchanged (`.gitignore` + STATUS.md). 09-14 and 09-21 runs each left a `.git/index.lock` via plain `git status`; both cleared by Eran. Permanent rule: weekly runs use `git --no-optional-locks` from the very first call.
- 2026-06-22 — Repo moved off OneDrive to `C:\dev\adaptivefit-mobile`; typecheck + lint green on new path. STATUS.md + CLAUDE.md seeded.
- (prior) — app icon, coach rename/delete, multi-thread coach refactor (0007), smart classifier, Gemini 2.5 Pro coach.
