# Deployment runbook — AdaptiveFit Mobile

Follow these in order. Estimated total time: 30–45 minutes.

---

## Step 1 — Rotate the Gemini API key (do this first)

You pasted your previous Gemini key in chat. It's compromised. Replace it now:

1. Open https://aistudio.google.com/app/apikey
2. Delete the old key (the one starting with `AIzaSy…6KyE`)
3. Click **Create API key** → pick or create a Google Cloud project → copy the new key
4. Save it somewhere only you control (1Password, Bitwarden, etc.)
5. **Do not paste it in chat or commit it.** It only goes in `.env` (locally) and Railway Variables (production)

---

## Step 2 — Generate auth secrets

```bash
# Run from anywhere — copy the output
openssl rand -base64 32
```

That's your `AUTH_SECRET`. Keep it.

---

## Step 3 — Configure Google OAuth client

You shared the client ID `341697057288-71k…vv1e.apps.googleusercontent.com`. You'll need the **client secret** too.

1. https://console.cloud.google.com → APIs & Services → Credentials
2. Click your OAuth 2.0 Client ID
3. Under **Authorised redirect URIs**, add both:
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
   - `https://<your-railway-domain>/api/auth/callback/google` (you'll know the domain after step 6)
4. Click **Save**, then go back into the client and copy the **client secret** if you haven't already

---

## Step 4 — Create the GitHub repo

```bash
# From the adaptivefit-mobile/ folder:
git init
git add .
git commit -m "Day 1: scaffold + coach + i18n + auth"
gh repo create eranganot/adaptivefit-mobile --private --source=. --push
```

If you don't have `gh` CLI:
1. Create the repo at https://github.com/new (name `adaptivefit-mobile`, private)
2. Then:
```bash
git remote add origin git@github.com:eranganot/adaptivefit-mobile.git
git branch -M main
git push -u origin main
```

---

## Step 5 — Set up local dev (optional, recommended)

```bash
pnpm install        # installs all deps
cp .env.example .env
# Edit .env and fill in all values:
#   DATABASE_URL — point at a local Postgres (Docker: `docker run --name pg -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:16`)
#                  then DATABASE_URL=postgresql://postgres:pw@localhost:5432/adaptivefit
#   AUTH_SECRET — paste from step 2
#   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET — from step 3
#   ALLOWED_EMAIL — eran.ganot@gmail.com
#   GEMINI_API_KEY — from step 1
#   NEXT_PUBLIC_APP_URL — http://localhost:3000

pnpm db:generate    # generates SQL from lib/db/schema.ts
pnpm db:migrate     # applies to local Postgres
pnpm test           # coach tests should be green
pnpm dev            # http://localhost:3000
```

Sign in with Google. You should land on Home.

---

## Step 6 — Deploy to Railway

You already have a Railway project: `0ccaffc5-6785-4d99-888d-4c0f5bffaffe`.

1. **Add Postgres plugin**
   - Open your Railway project
   - Click **+ New** → **Database** → **PostgreSQL**
   - Wait for provisioning. Railway auto-injects `DATABASE_URL` into other services in the project.

2. **Add the Next.js service**
   - Click **+ New** → **GitHub Repo** → pick `adaptivefit-mobile`
   - Railway will detect Node and start building

3. **Set Variables** on the Next.js service (Variables tab):

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | From step 2 |
   | `AUTH_GOOGLE_ID` | From step 3 |
   | `AUTH_GOOGLE_SECRET` | From step 3 |
   | `ALLOWED_EMAIL` | `eran.ganot@gmail.com` |
   | `GEMINI_API_KEY` | From step 1 |
   | `NEXT_PUBLIC_APP_URL` | `https://<railway-domain>` (set after first deploy) |

   `DATABASE_URL` is injected automatically by the Postgres plugin — don't paste it.

4. **First deploy + domain**
   - Railway will fail the first build because `NEXT_PUBLIC_APP_URL` is empty
   - Once Railway assigns a domain (under Settings → Networking → Generate Domain), copy it
   - Set `NEXT_PUBLIC_APP_URL=https://<that-domain>` in Variables
   - Add the same domain's `/api/auth/callback/google` URL to Google OAuth (step 3)
   - Click **Deploy** to retry

5. **Run the first migration**
   - Build command in `railway.toml` already runs `pnpm db:migrate` automatically
   - Verify by opening Railway logs after deploy — you should see `Migrations complete.`

---

## Step 7 — Install on Pixel 9

1. Open Chrome on your Pixel 9
2. Visit your Railway URL
3. Sign in with Google
4. Tap the three-dot menu → **Install app** (or "Add to Home screen")
5. Launch from the home screen — runs in standalone mode

---

## Step 8 — Verify the round trip

- Sign in works (only `eran.ganot@gmail.com` is allowed)
- Bottom nav switches between Home / Workouts / Goals / Analytics
- Switch language by setting `locale=he` cookie (DevTools → Application → Cookies) and reload — UI flips to RTL Hebrew
- `pnpm test` passes locally (Coach FSM is the load-bearing logic)

---

## Day 2 onwards

- **Day 2** — wire workout logging end to end (form → Gemini extract → coach update). Migration adds the indexes we need.
- **Day 3** — Goals form + active goal card.
- **Day 4** — Analytics charts (the dual-axis dashboard).
- **Day 5** — Gemini history importer.
- **Day 6** — polish, Lighthouse pass, custom domain (optional).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `DATABASE_URL is not set` | Postgres plugin not attached | Add it in Railway, redeploy |
| Sign-in fails with `redirect_uri_mismatch` | OAuth callback URL not added | Step 3 — add the Railway domain callback URL |
| `Gemini returned invalid JSON` | Rate limit or model regression | Retry; check `GEMINI_MODEL_FAST` env value |
| PWA won't install on Pixel 9 | Manifest missing icons | Drop two PNGs into `public/icons/` (see `public/icons/README.md`) |
| Build fails on `pnpm db:migrate` | `drizzle/` folder empty | Run `pnpm db:generate` locally and commit the SQL files |

---

## Security notes

- Every secret lives in `.env` (local) or Railway Variables (prod). Never commit, never paste in chat.
- `ALLOWED_EMAIL` enforces single-tenant access at the Auth.js layer. If you ever expand users, switch to a proper DB allowlist and remove that env var.
- Railway service should **not** be set to "public" with an open allowlist — keep it accessible only via your sign-in.
