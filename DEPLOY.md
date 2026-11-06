# Deploy guide — Veridis Finance

Two apps in this monorepo:

- `veridis-finance/` — Fastify API + PostgreSQL (deploy to Railway/Render/Fly)
- `veridis-finance-frontend/` — Next.js 14 (deploy to Vercel)

## Local (one command)

```bash
docker compose up --build
# open http://localhost:3000
# login: slug 642-studio / admin@642studio.com / ChangeMe123!
```

---

## Backend + Postgres on Railway

1. New Project → Deploy from GitHub repo.
2. Service **Settings → Root Directory = `veridis-finance`** (uses `railway.json`).
3. Add a **PostgreSQL** database (creates `DATABASE_URL`).
4. Service **Variables**:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | a strong secret (reuse in the frontend) |
   | `AI_MASTER_KEY` | a strong 32+ char secret |
   | `CORS_ORIGIN` | your Vercel URL, e.g. `https://your-app.vercel.app` |
   | `DB_SSL` | `true` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

   `railway.json` already sets the start command to apply the schema
   (`node scripts/apply-schema.js`) and then start the server, with a
   `/health` healthcheck.
5. Deploy, then copy the service's public URL (the API base).
6. (Optional) Seed a demo tenant: open a service shell and run `node scripts/seed.js`.

## Frontend on Vercel

1. Add New → Project → import this repo.
2. **Root Directory = `veridis-finance-frontend`** (Next.js auto-detected;
   `vercel.json` handles the `/` → `/login` redirect).
3. **Environment Variables**:

   | Variable | Value |
   |---|---|
   | `VERIDIS_API_URL` | the Railway API URL from above |
   | `JWT_SECRET` | the **same** value as the backend |
   | `NEXT_PUBLIC_NOTIFICATION_LIBRARY` | `sonner` |

4. Deploy. The Vercel URL is your public site.

## Wire them together

1. Set the backend `CORS_ORIGIN` to the exact Vercel URL (https, no trailing
   slash) and redeploy.
2. Open the Vercel URL → Register, or log in with the seeded demo user.

### Gotchas

- `JWT_SECRET` **must be identical** in backend and frontend, or login won't persist.
- In production `CORS_ORIGIN` must be an explicit origin — the backend rejects a
  wildcard on purpose (`src/config/env.js`).
- Both platforms serve HTTPS, so the frontend's secure auth cookie works.

## Core Finance bridge

Deploy the Finance changes together with the Core adapter. Set the same random
`CORE_FINANCE_SECRET` (minimum 32 characters) on both servers. Core additionally
requires `VERIDIS_FINANCE_URL` and `VERIDIS_FINANCE_ORGANIZATION_ID` pointing to an
existing organization in this database. The bridge accepts only signed tokens
with issuer `642-core`, audience `veridis-finance` and a lifetime of 60 seconds.
Core staff read-only roles map to `viewer`; Core administrators map to `admin`.
Browser clients never receive the bridge secret or the provider credentials.

The API production deployment now uses the Core database (`finance` schema) through
`finance_core_runtime`. Keep `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=true` and
`DB_SSL_CA` set to the official Supabase CA PEM. Preserve the original
`AI_MASTER_KEY`; changing it makes the migrated encrypted values unreadable.
The Vercel build runs `npm run db:check`, a read-only check of the 25 applied
migrations. Do not run `db:migrate` using the restricted runtime login; future
schema changes require a separate migration account.

Verified on 2026-11-05: production health reports database connected, ten read
endpoints return 200 with a signed Core token, and unauthenticated requests return
401. The Core bridge variables are configured locally and in Vercel.

Before enabling real fiscal issuance, verify Facturama sandbox issuance, replay,
PDF/XML and cancellation from the Core. Unit tests and the isolated SQL harness
do not replace provider acceptance testing.
