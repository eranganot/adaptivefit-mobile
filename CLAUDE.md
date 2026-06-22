# AdaptiveFit — Claude working notes

Running-coach PWA. Next.js + Postgres + Gemini, deployed on Railway (auto-deploy on push to `main`). Owner: Eran (bilingual EN/HE, tests on a Pixel 9).

## How to work in this repo

- **Read `STATUS.md` first** every session to recover where we left off. Update it when you ship something or end a session.
- **Package manager is pnpm.** Verify with `pnpm typecheck` and `pnpm lint` before any deploy.
- **The sandbox cannot push** (no git credentials + OneDrive locks). Make the edits, then hand Eran one copy-paste PowerShell block to run on his machine. Never try to `git push` from the sandbox.
- **Deploy via the `ship-it` skill** — it has the exact git + Railway recipe and the lock/stale-cache workarounds.
- **Triage bugs via the `app-bug-triage` skill** — get the Railway log line / deploy status before editing.

## Known sharp edges
- OneDrive locks `.git/index.lock` and `HEAD.lock`; clear with `Remove-Item … -ErrorAction SilentlyContinue` from PowerShell. (Pending fix: move repo to `C:\dev\` — see migration-plans.)
- After renaming/deleting a dynamic route, nuke `.next` or typecheck references the dead route. If a route dir won't delete, use `git rm -rf`.
- Two dynamic slug names at one path level (`[workoutLogId]` + `[threadId]`) breaks the build — only one allowed.
- Coach must get a server-side `Asia/Jerusalem` timestamp injected or it hallucinates dates.
- i18n keys must be **nested**, not flat-with-dots, or next-intl throws `MISSING_MESSAGE`.

## Response style (token-saving)
- Keep deploy/round summaries to a **short checklist**, not multi-section essays. Name files changed + the commands to run + 2–5 smoke checks. That's it.
- Edit in place; don't re-read a file you just wrote.
- For broad "where is X" searches, use the Explore subagent so the main thread stays lean.
