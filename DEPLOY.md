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
