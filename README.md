# GBMjobhunter

[![CI](https://github.com/Surya97141/GBMjobhunter/actions/workflows/ci.yml/badge.svg)](https://github.com/Surya97141/GBMjobhunter/actions/workflows/ci.yml)

A job-search intelligence platform. It does three things:

1. **Tracks applications** on a Kanban board (saved → applied → interview → offer / ghosted / rejected).
2. **Turns anonymised cohort data into insights.** A nightly pipeline computes ghost rates, rejection rates and ATS scores per skill cluster and role bucket, then surfaces personalised cards on the dashboard.
3. **Auto-fills job applications** through a Chrome extension that detects ATS forms (Greenhouse, Lever, Workday, ...) and fills them from the user's profile and parsed resume.

## Architecture

```
 Web (React/Vite)   Chrome extension (MV3)   Mobile (Expo)
          \                 |                  /
           └────────►  Gateway :3000  ◄───────┘      JWT, CORS, rate limits
                            │
      ┌─────────────┬───────┴───────┬──────────────┐
   user :3001    jobs :3002   opportunity :3003   agent :3005
   auth, resume  applications  courses/communities  AI router
                      │                             (Groq / Claude)
                      ▼ BullMQ (Redis)
              intelligence worker  ──►  PostgreSQL
              nightly cohort analytics
```

- **Gateway** is the only public backend. It verifies JWTs and proxies to the services.
- **Async pipeline:** the jobs service publishes `application.logged` / `outcome.updated` events. The intelligence worker strips PII, stores events, and runs a nightly job that computes cohort patterns (minimum cohort size 50) and fans insights out to users.
- **Delivery semantics:** BullMQ is at-least-once, so event inserts use `ON CONFLICT DO NOTHING` to keep retries from overwriting real outcomes.
- **AI tiers:** Tier 2 (Groq, Llama 3.3 70B) for parsing and extraction; Tier 3 (Claude Haiku) for diagnostics and cover letters, with a per-user daily quota in Redis.

## Tech stack

React 18 · Vite · React Router · Framer Motion · React Native (Expo) · Chrome MV3 · Node/Express · PostgreSQL 15 · Redis 7 + BullMQ · Docker Compose · Caddy · npm workspaces

## Repository layout

| Path | What it is |
|---|---|
| `gateway/` | Express API gateway |
| `services/user` · `jobs` · `opportunity` · `agent` | Express microservices |
| `services/intelligence` | Background worker (no HTTP port) |
| `web/` | React web app |
| `mobile/` | React Native app |
| `extension/` | Chrome extension (no build step) |
| `shared/` | Shared utilities |
| `migrations/` | Sequential SQL migrations |
| `scripts/` | Migration runner, seed and deploy scripts |

## Running it locally

Prerequisites: Node 18+, Docker.

```bash
npm install

# 1. Postgres and Redis
docker-compose up -d postgres redis

# 2. Configure env: copy each .env.example to .env and fill it in
#    (root, gateway/, and each service that has one)

# 3. Create the schema
npm run migrate

# 4. Start all backend services, then the web app (separate terminals)
npm run backend
npm run web
```

Load the extension from `extension/` via `chrome://extensions` → Developer mode → Load unpacked.

`docker-compose.yml` runs the full stack (all services plus Postgres and Redis) the way production does, behind Caddy. Its variables come from a `.env.production` file based on the blank template.

## Tests

Tests use Jest + Supertest with Postgres and Redis mocked, so no containers are needed:

```bash
npm test      # runs every workspace that defines tests
npm run build # production build of the web app
```

CI (`.github/workflows/ci.yml`) runs both on every push to `main` and on pull requests.

Current coverage: gateway (24 tests: JWT enforcement, routing, header spoofing, CORS, upstream failures), intelligence pipeline (21: PII stripping, idempotent event inserts, cohort-size threshold, pattern upserts), user auth (10) and job applications (9). The agent and opportunity services are untested so far.

## Further reading

Deeper design docs are in the repo root:

- [CODEBASE_BRIEFING.md](CODEBASE_BRIEFING.md): full overview of every service, table and decision
- [NOTEBOOK_1_ARCHITECTURE.md](NOTEBOOK_1_ARCHITECTURE.md) · [2_DATABASE](NOTEBOOK_2_DATABASE.md) · [3_PIPELINE](NOTEBOOK_3_PIPELINE.md) · [4_AI](NOTEBOOK_4_AI.md) · [5_FRONTEND](NOTEBOOK_5_FRONTEND.md) · [6_DEVOPS](NOTEBOOK_6_DEVOPS.md) · [7_SERVICES](NOTEBOOK_7_SERVICES.md)
