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

Both [`vercel.json`](../vercel.json) and [`web/vercel.json`](../web/vercel.json) exist, for a project whose Root
Directory is the repo root or `web/`; keep them in sync. Their SPA rewrite deliberately excludes `/assets/`:
a missing hashed asset must return 404, not `index.html`. Serving HTML for a missing chunk is what produced
`error loading dynamically imported module` / `Unable to preload CSS` in a tab left open across a redeploy.
The app reloads once on such an error to pick up the new build. Vercel's optional **Skew Protection**
(project settings) additionally keeps serving the previous deployment's assets to old tabs.

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
- **Memory.** Six Node processes (gateway, four services, the intelligence worker) share one small instance.
  Five of them used about 330 MB on a Windows dev machine; the agent service was added since, so measure on
  Render's dashboard after deploying. If it runs out, set `DEMO_RUN_WORKER=false` to drop the intelligence
  worker (insights are seeded), or `DEMO_RUN_AGENT=false` to drop AI.

## What the demo includes

| Feature | In the demo |
|---|---|
| Application tracking, dashboard, profile | Live, backed by a real database and API gateway |
| Insight cards, insights map | Sample data seeded for the demo, not computed from real applicants |
| Async pipeline (events to worker to database) | Live: logging or moving a new application produces an event the worker stores |
| Opportunities | Curated static data |
| Resume parsing, profile suggestions | Live; rule-based parsing, no AI involved |
| AI explanations (Opportunities, Hidden Curriculum Decoder) | Bring-your-own-key always; shared demo key only if `GROQ_API_KEY` is set |
| Chrome extension, mobile app | Separate installs, not part of the hosted demo |

## AI modes

The web app's AI explanations run through the agent service in one of two modes:

- **Demo (shared key).** Set `GROQ_API_KEY` on the Render service (dashboard only; `render.yaml` declares
  it with `sync: false` and no value). Never commit a key. Requests are limited per user per day
  (`AI_DEMO_DAILY_LIMIT_PER_USER`, default 20) and for all users together (`AI_DEMO_DAILY_LIMIT_TOTAL`,
  default 500). If the variable is missing, demo mode shows as unavailable and nothing else changes.
- **Bring your own key.** A user picks Groq or OpenAI and pastes their key. The key is held in
  the browser tab's memory only (not localStorage, sessionStorage or the database), sent over HTTPS with
  each AI request to the authenticated gateway, relayed to the agent service, used for that one provider
  call and dropped. It is not logged, and provider error text is never returned, since some providers echo
  part of the key. Provider endpoints are fixed in code; requests cannot set a base URL or model.

Anthropic is implemented but **disabled** unless `AI_ENABLE_ANTHROPIC=true` on the agent service. Its
requests are tested offline against the installed SDK with a fake transport, but have not been checked
against the live API with a real key, so do that before enabling it. While disabled it is not listed and
requests that select it are rejected.

The gateway limits the model-calling `/agent/*` routes (POST guidance, decoder, cover letter, outreach)
to `AI_RATE_LIMIT_PER_MINUTE` (default 10) per user; status and health checks are not counted. It waits up to
`AGENT_PROXY_TIMEOUT_MS` (default 30 s) for a reply. The agent's provider timeout is `AI_TIMEOUT_MS`
(default 25 s). Optional model overrides: `GROQ_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`.

What a provider receives: for Opportunities guidance, the user's resume skills, target role and the
recommended skills; for the decoder, the chosen topic and the resume skills. The UI says this before each
request.

## Demo accounts

`POST /auth/demo` creates a throwaway user with sample data. It is rate limited to 10 per hour per IP at the
gateway. Demo users older than 4 hours, and all of their data, are deleted automatically the next time
someone starts a demo. The endpoint exists only when `DEMO_MODE_ENABLED=true`, which the launcher sets, so a
normal deployment does not expose it.
