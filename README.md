# AdaptiveFit Mobile

Personal AI running coach. Single-user PWA for Pixel 9. Next.js 15 + Drizzle/Postgres + Gemini, deploy on Railway.

## Status

Day 1 scaffold complete. Coach algorithm + schema + Gemini extraction lifted from `eranganot/adaptivefit`. UI shell ships with bottom nav, sign-in, and bilingual EN/HE. Workout-log form, Goals tab, Analytics charts, and Gemini history importer land in Days 3–5.

## Stack

- **Next.js 15** (App Router) — single Railway service, server actions for forms
- **Drizzle ORM + Postgres** (Railway plugin)
- **Auth.js v5** with Google provider, allowlisted email
- **Gemini** (`gemini-1.5-flash` for extraction, `gemini-1.5-pro` for cold-start import)
- **next-intl** for EN/HE
- **shadcn/ui + Tailwind**, **Recharts** for analytics
- **Vitest** for coach tests

## Quick start (local)

```bash
pnpm install
cp .env.example .env  # then fill in values
pnpm db:generate      # generate migration SQL from schema.ts
pnpm db:migrate       # apply to local Postgres
pnpm dev              # http://localhost:3000
pnpm test             # coach algorithm tests
```

## Project layout

```
app/
  (app)/{home,workouts,goals,analytics}/   bottom-nav routes
  (auth)/sign-in/                          sign-in page
  api/{auth,workouts,goals,coach,...}      route handlers
  layout.tsx, page.tsx, globals.css

lib/
  auth/                  Auth.js config + handlers
  coach/                 conservative-coach FSM (pure functions)
  db/                    Drizzle client + schema
  gemini/                Gemini client + prompt modules
  i18n/                  next-intl request config
  utils/                 cn helper, date helpers, etc.

components/
  custom/BottomNav.tsx
  ui/                    shadcn primitives (added on demand)

messages/{en,he}.json    UI strings
drizzle/                 generated migrations
public/manifest.json     PWA manifest
tests/coach/             Vitest specs
scripts/migrate.ts       node-postgres migrator runner
```

## Coach algorithm — quick reference

Pure functions in `lib/coach/index.ts`. Rules in priority order:

1. **Hard freeze** — any `foot_pain >= 7` in last 7 days → recovery only
2. **Soft freeze** — 7-day average `foot_pain >= 4` → no progression
3. **Interval reduction** — last run flagged `breathing_dereg` or `form_breakdown` → blocks reduced 25%
4. **Green session** — RPE ≤ 7 AND foot_pain ≤ 3 → increment counter
5. **Promotion** — 3 greens in a row → level + 1, distance + 20%
6. **Default** — repeat last week

See `tests/coach/coach.test.ts` for the contract.

## Deploy

See `DEPLOY.md` for the runbook.

## Rotate the Gemini key

If the key was ever pasted in chat, screenshot, or commit, rotate immediately:

1. https://aistudio.google.com/app/apikey → delete the old key
2. Create a fresh key
3. Update locally in `.env` and in Railway under Variables
4. Never paste it in chat again

## License

Private. Personal app.
