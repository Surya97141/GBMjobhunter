# Deploying the hosted demo (Vercel + Render, free tier)

The demo is split across two hosts:

| Part | Host | Why |
|---|---|---|
| Web app (`web/`) | **Vercel** | Static Vite build served from a CDN. No cold starts. |
| Gateway + all backend services + worker | **Render**, one free web service | Express services need long-lived processes, which serverless can't provide. |
| Postgres, Redis | **Render** free Postgres and Key Value | Isolated demo data, separate from any real deployment. |

All backend processes run inside **one** Render service (`scripts/demo-start.js`). A free
service sleeps when idle, so running each backend separately would chain cold starts and
use up the shared free-hours budget. Free-tier terms change: re-check
[Render's free tier docs](https://render.com/docs/free) before you deploy.

## 1. Deploy the backend on Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. Render reads [`render.yaml`](../render.yaml) and proposes a
   Postgres database, a Key Value instance and one web service (`gbm-demo-api`).
3. When prompted for `ALLOWED_ORIGINS`, enter a placeholder for now. You will set the real value in step 3.
4. Apply. The first start runs all migrations and seeds skill-demand data automatically, then launches the
   services. Both steps are idempotent, so every redeploy is safe.
5. Open `https://<your-service>.onrender.com/health`. It should return `{"status":"ok"}`.

The service URL is shown at the top of the service page. It may differ from the name in `render.yaml`.

## 2. Deploy the web app on Vercel

1. In Vercel: **Add New → Project**, import the same repo. Leave the root directory as the repo root:
   [`vercel.json`](../vercel.json) sets the install command, build command, output folder and SPA fallback.
2. Add an environment variable:
   `VITE_API_URL=https://<your-service>.onrender.com` (no trailing slash, no `/api`).
3. Deploy. Note your production URL, for example `https://gbm-demo.vercel.app`.

## 3. Allow the web app to call the API

Back in Render, open the `gbm-demo-api` service → **Environment** and set
`ALLOWED_ORIGINS` to your Vercel production URL (comma-separate more than one). Save, and the service restarts.

Vercel **preview** URLs are different origins. Add one here if you want to test a preview build.

## 4. Check it end to end

```bash
curl https://<your-service>.onrender.com/health
curl -X POST https://<your-service>.onrender.com/auth/demo   # returns a token and a demo user
```

Then open the Vercel URL and click **Try the demo**. You should land on a dashboard showing 10 sample
applications. Drag a card on the tracker and the dashboard counts change.

## 5. Keep it awake (optional, free)

A free Render web service sleeps after about 15 minutes without traffic and takes about a minute to wake.
A recruiter hitting a sleeping demo would wait that long. A free uptime monitor (for example UptimeRobot)
pinging `https://<your-service>.onrender.com/health` every 5 minutes keeps it awake.

One always-on service uses roughly 720 of the free instance hours in a month. If you add other free
services to the same Render workspace, you may exceed the allowance, so check the current limits first.

## What to expect from the free tier

- **Postgres expires.** Free databases are time-limited and have no backups (my sources disagree on whether
  the window is 30 or 90 days: confirm on Render's docs). That is acceptable here because the data is
  synthetic. When it expires, create a new database and point `DATABASE_URL` at it. The launcher re-runs
  the migrations and seeding on the next start.
- **Redis is in-memory.** A restart clears queued jobs and rate-limit counters. `maxmemoryPolicy` is
  `noeviction` because BullMQ would silently lose jobs under eviction.
- **Memory.** Five Node processes share one small instance. On a Windows dev machine they used about
  330 MB in total; measure on Render's dashboard after the first deploy. If it runs out, set
  `DEMO_RUN_WORKER=false` to drop the intelligence worker. The demo still works, because insights are seeded.

## What the demo includes

| Feature | In the demo |
|---|---|
| Application tracking, dashboard, profile | Live, backed by a real database and API gateway |
| Insight cards, insights map | Sample data seeded for the demo, not computed from real applicants |
| Async pipeline (events to worker to database) | Live: logging or moving a new application produces an event the worker stores |
| Opportunities | Curated static data |
| AI features (resume parsing, cover letters) | Not enabled: no agent service or provider keys |
| Chrome extension, mobile app | Separate installs, not part of the hosted demo |

## Demo accounts

`POST /auth/demo` creates a throwaway user with sample data. It is rate limited to 10 per hour per IP at the
gateway. Demo users older than 4 hours, and all of their data, are deleted automatically the next time
someone starts a demo. The endpoint exists only when `DEMO_MODE_ENABLED=true`, which the launcher sets, so a
normal deployment does not expose it.
