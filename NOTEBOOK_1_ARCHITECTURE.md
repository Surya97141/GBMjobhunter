# Notebook 1 — Architecture: Services, Gateway, and Docker Network

---

## 1. The Six Services

### Gateway
**What it does:** Sits in front of every other service. It is the only entry point from the outside world. It checks CORS, parses JSON bodies, verifies JWTs, enforces rate limits, and forwards each request to whichever backend service owns that route. It never touches the database.

**Port:** 3000

**Entry point:** `gateway/index.js`

**Key dependencies:** `express`, `helmet`, `cors`, `jsonwebtoken`, `axios` (for JSON proxying), Node's built-in `http` module (for streaming multipart uploads), `express-rate-limit`, `rate-limit-redis`

**HTTP routes exposed directly (not proxied):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{ status: 'ok' }`. No JWT. Always 200. |

All other routes are proxied — see Section 2.

---

### User Service
**What it does:** Handles everything related to a user's identity and profile. It registers and logs in users, issues JWTs, stores resume PDFs, parses them into structured JSON using `pdf-parse`, serves personalised insight cards from the database, and lets users update their name, target role, and cover letter template.

**Port:** 3001

**Entry point:** `services/user/index.js`

**Key dependencies:** `bcrypt` (password hashing), `jsonwebtoken` (JWT issuance), `multer` (PDF upload handling), `pdf-parse` (PDF → text extraction), `pg` (Postgres), `redis`, `zod` (input validation), `uuid`

**HTTP routes exposed:**

| Method | Path | Auth (internal) | Description |
|--------|------|-----------------|-------------|
| POST | `/auth/register` | None | Create account, returns JWT |
| POST | `/auth/login` | None | Verify credentials, returns JWT |
| GET | `/users/me` | `requireAuth` | Return profile + resume JSON |
| PUT | `/users/me` | `requireAuth` | Update name, target_role, cover_letter_template |
| POST | `/users/me/resume` | `requireAuth` | Accept PDF upload, parse and store as `resume_json` |
| GET | `/users/me/resume` | `requireAuth` | Return the stored resume JSON |
| GET | `/users/me/insights` | `requireAuth` | Return this user's insight cards |
| PUT | `/users/me/insights/:id/seen` | `requireAuth` | Mark an insight card as seen |

Note: the user service has its own `requireAuth` middleware that re-verifies the JWT. Protected routes are therefore verified twice — once at the gateway and once inside the service. The gateway passes the `Authorization` header downstream unchanged, so the token is available for both checks.

---

### Jobs Service
**What it does:** Manages the application tracker. Users log job applications, move them through statuses (saved → applied → interview → offer/ghosted/rejected), and get ghost-risk scores for individual job descriptions. It also exposes a skill demand/supply endpoint. When a new application is logged or an outcome is set, it publishes a BullMQ job to Redis for the intelligence service to consume asynchronously.

**Port:** 3002

**Entry point:** `services/jobs/index.js`

**Key dependencies:** `bullmq` (event publishing to Redis queues), `pg`, `redis`, `zod`, `uuid`

**HTTP routes exposed:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/applications/stats` | Aggregate stats (counts by status/outcome) |
| POST | `/applications/score` | Score a job description against the user's resume (ghost-risk) |
| GET | `/applications` | List all applications for this user |
| POST | `/applications` | Log a new application; publishes to `application.logged` queue |
| PUT | `/applications/:id/outcome` | Set final outcome; publishes to `outcome.updated` queue |
| GET | `/jobs/demand-supply` | Skill demand/supply leaderboard |
| GET | `/jobs/ghost-score` | Ghost score for a given job description |

Route order matters: `/applications/stats` and `/applications/score` are defined before `/:id` to prevent Express from treating `stats` and `score` as application IDs.

---

### Opportunity Service
**What it does:** Returns curated non-job opportunities: courses, communities, and skill paths. It reads from static in-memory data files and cross-references the `cohort_patterns` table to personalise results. It never writes to the database.

**Port:** 3003

**Entry point:** `services/opportunity/index.js`

**Key dependencies:** `pg`, `express`, `zod`

**HTTP routes exposed:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/opportunities` | Return personalised courses and skill paths |
| GET | `/opportunities/communities` | Return curated community list |

---

### Intelligence Service
**What it does:** A pure background worker with no HTTP server. It listens to four BullMQ queues on Redis and runs the nightly analytics pipeline. When the jobs service publishes an `application.logged` event, intelligence strips PII and stores the anonymised record in `application_events`. When the nightly cron fires, it computes cohort ghost rates, writes pattern rows, and fans out insight cards to matched users.

**Port:** None. It never calls `app.listen()` and exposes no HTTP endpoints.

**Entry point:** `services/intelligence/index.js`

**Key dependencies:** `bullmq` (Worker, Queue, QueueScheduler), `pg`, `axios`, `uuid`

**BullMQ workers:**

| Queue consumed | What it does |
|----------------|--------------|
| `application.logged` | Strips PII from event, inserts into `application_events` |
| `outcome.updated` | Updates `outcome` and `response_days` for an existing event |
| `nightly-computation` | Runs pattern computation + skill impact, then fires `pattern.computed` |
| `pattern.computed` | Calls `publishInsightsForPatterns()` to write `user_insights` rows |

---

### Agent Service
**What it does:** Routes AI model calls through a three-tier system. Tier 2 uses Groq (OpenAI-compatible API, model: `llama-3.3-70b-versatile`) for cover letters and hiring process explanations. Tier 3 uses Anthropic Claude (`claude-haiku-4-5-20251001`) for outreach message drafting. Both tiers are optional — if their API keys are missing, the service starts fine and returns structured `not_configured` error responses instead of crashing. Per-user Tier 3 quota (default 50 calls/day) is enforced inside this service via Redis.

**Port:** 3005

**Entry point:** `services/agent/index.js`

**Key dependencies:** `@anthropic-ai/sdk`, `express`, `pg`, `redis`, `zod`

**HTTP routes exposed:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agent/health` | Reports tier configuration status and quota settings |
| POST | `/agent/generate-cover-letter` | Tier 2 — 3-paragraph cover letter. Requires `role`, `company` in body |
| POST | `/agent/generate-outreach` | Tier 3 — outreach message. Requires `companyName`, `roleTitle`. Pulls company signals and user skills from DB for context. Requires `x-user-id` header |
| POST | `/agent/explain-hiring-process` | Tier 2 — explains one hiring topic using a four-barrier pedagogy. Valid topics: `behavioral round`, `recruiter first-30-seconds screen`, `talking about a project`, `what culture fit means`, `following up after an interview`. Requires `x-user-id` header |

If Tier 2 env vars are absent, `generate-cover-letter` and `explain-hiring-process` return `{ success: false, error: 'not_configured', ... }` with HTTP 200. If Tier 3 is absent, `generate-outreach` returns the same. If the user's daily Tier 3 quota is exhausted, it returns `{ success: false, error: 'quota_exceeded', ... }`.

---

## 2. The Gateway Routing Table

The gateway processes every route through this decision tree, in order. Express matches the first prefix that fits.

| Route pattern (at gateway) | Forwards to | JWT required | Rate limit | Special handling |
|---------------------------|-------------|:---:|---|---|
| `GET /health` | Gateway itself (not proxied) | No | None | Returns `{ status: 'ok' }` directly |
| `ALL /auth/*` | user-service:3001 | No | 100 req/min | Standard JSON `forward()` |
| `POST /users/me/resume` | user-service:3001 | Yes | 10 req/min | **Raw stream** `streamForward()` — pipes multipart body unmodified |
| `ALL /users/*` | user-service:3001 | Yes | 100 req/min | Standard JSON `forward()` |
| `ALL /applications/*` | jobs-service:3002 | Yes | 100 req/min | Standard JSON `forward()` |
| `ALL /jobs/*` | jobs-service:3002 | Yes | 100 req/min | Standard JSON `forward()` |
| `ALL /opportunities/*` | opportunity-service:3003 | Yes | 100 req/min | Standard JSON `forward()` |
| `ALL /agent/*` | agent-service:3005 | Yes | 100 req/min | Standard JSON `forward()` |
| Anything else | Gateway itself | — | — | Returns 404 `{ status: 'error', message: 'Route not found' }` |

**Why `/users/me/resume` is listed before `/users/*`:** Express matches routes in registration order. If `/users/*` came first, the resume upload POST would be caught by the JSON `forward()` function, which would pass an empty body to the user service (because `express.json()` does not read `multipart/form-data`). By registering the specific `POST /users/me/resume` route first, that request is intercepted and streamed raw to the upstream service.

**Rate limit key:** Both limiters key by `req.user?.sub || req.ip`. After JWT verification, `req.user.sub` is the user's UUID, so authenticated requests are bucketed per user. Unauthenticated `/auth/*` requests are bucketed by IP address. Counters are stored in Redis, so they survive gateway restarts and work correctly if the gateway is ever scaled to multiple instances.

**Proxy timeout:** `forward()` sets a 9-second Axios timeout. If the upstream service does not respond within 9 seconds, the gateway returns `502 { status: 'error', message: 'Upstream service unavailable' }`.

**Intelligence service has no gateway route.** It communicates only through BullMQ queues, never via HTTP. No request from the outside world ever reaches it directly.

---

## 3. The Docker Network

All containers join a single bridge network called `gbm-network`. Inside this network, Docker provides DNS so that each container is reachable by its service name as a hostname. The gateway is configured with the downstream URLs set to these internal hostnames:

| Service name (Docker) | Internal hostname | Internal port | Available to |
|-----------------------|-------------------|:---:|---|
| `postgres` | `postgres` | 5432 | All services on `gbm-network` |
| `redis` | `redis` | 6379 | All services on `gbm-network` |
| `gateway` | `gateway` | 3000 | All services + host (via port binding) |
| `user-service` | `user-service` | 3001 | All services (gateway accesses `http://user-service:3001`) |
| `jobs-service` | `jobs-service` | 3002 | All services |
| `opportunity-service` | `opportunity-service` | 3003 | All services |
| `intelligence-service` | `intelligence-service` | — | All services (no HTTP — only connects outbound to Redis) |
| `agent-service` | `agent-service` | 3005 | All services |

**What is exposed to the host machine:**

| Container | Host binding | Accessible from |
|-----------|-------------|-----------------|
| `postgres` | `127.0.0.1:5432 → 5432` | Host machine only (for running migrations via `node scripts/migrate.js`) |
| `redis` | None | Not accessible from host |
| `gateway` | `127.0.0.1:3000 → 3000` | Host machine only (Caddy on the host proxies to this) |
| All other services | None | Not accessible from host |

The `127.0.0.1` binding means the ports are bound to the loopback interface only — a machine on the internet cannot reach them even if the VPS firewall rule is misconfigured. Caddy, which runs on the host (not in Docker), forwards HTTPS traffic to `localhost:3000`, which reaches the gateway.

**Startup order:** Every service has `depends_on` with `condition: service_healthy` for both `postgres` and `redis`. Docker Compose will not start any service until postgres passes `pg_isready` and redis responds to `PING`. This prevents boot-time connection errors from services trying to connect before the databases are ready.

---

## 4. Startup Dependencies

Every service runs its env var checks synchronously before any async work begins. A missing required variable throws a `new Error(...)` which crashes the Node process immediately with a clear message. Docker Compose's `restart: unless-stopped` policy then restarts the container, and you will see the error message in `docker compose logs <service-name>`.

| Service | Required at boot | What breaks if missing |
|---------|-----------------|------------------------|
| Gateway | `JWT_SECRET`, `USER_SERVICE_URL`, `JOBS_SERVICE_URL`, `OPPORTUNITY_SERVICE_URL`, `REDIS_URL` | Process throws and exits. No requests are served. |
| User service | `JWT_SECRET`, `DATABASE_URL` | Process throws and exits. Login and registration fail for all users. |
| Jobs service | `DATABASE_URL`, `REDIS_URL` | Process throws and exits. Application tracking is unavailable. |
| Opportunity service | `DATABASE_URL` | Process throws and exits. Opportunities page fails. |
| Intelligence service | `DATABASE_URL`, `REDIS_URL` | Process throws and exits. BullMQ workers never start; events queue up in Redis but are never processed. |
| Agent service | `REDIS_URL` | Process throws and exits. All AI features fail. |

**Agent service — soft-optional env vars:** `TIER2_API_BASE`, `TIER2_API_KEY`, `TIER2_MODEL_NAME`, `TIER3_API_KEY`, `TIER3_MODEL`, `TIER3_QUOTA_PER_DAY`, `MODEL_TIMEOUT_MS`. These are checked at call time, not at boot. If any Tier 2 vars are missing, cover letter and hiring explanation routes return `{ success: false, error: 'not_configured', missing: [...] }`. If `TIER3_API_KEY` is missing, outreach drafting returns the same. The service boots and serves requests regardless.

**Note on `PORT`:** All services fall back to a hardcoded default port if `PORT` is not set. Because `PORT` is set explicitly in `docker-compose.yml` for each service, this fallback only matters in local development.

---

## 5. The CORS Policy

The CORS logic lives in `gateway/index.js`. Express evaluates three conditions in order for every cross-origin request:

**Condition 1 — No `Origin` header:** Allow unconditionally. This covers requests from curl, Postman, server-to-server calls, and the React Native mobile app (Expo does not send an `Origin` header for native HTTP calls). These requests pass through without CORS overhead.

**Condition 2 — Origin starts with `chrome-extension://`:** Allow unconditionally. This means any installed Chrome extension — regardless of its extension ID — is allowed to call the API. The extension ID changes every time an extension is reloaded in developer mode, so hardcoding a specific ID would break local development. In production this is acceptable because the extension must also present a valid JWT to reach any protected route.

**Condition 3 — Origin is in the `ALLOWED_ORIGINS` list:** Allow. The list is built by splitting the `ALLOWED_ORIGINS` environment variable on commas. If the env var is not set, it defaults to `'http://localhost:5173'` (the Vite dev server). `credentials: true` is set, which means cookies and `Authorization` headers are included in cross-origin requests.

**All other origins:** Rejected. The `cors` middleware calls back with an error, and the request receives a CORS error before it reaches any route handler.

**How to add a production origin:** Set `ALLOWED_ORIGINS` in the production `.env` file to a comma-separated string of allowed origins. For example:

```
ALLOWED_ORIGINS=https://gbmjobhunter.com,https://www.gbmjobhunter.com
```

Restart the gateway container after changing this. No code changes are needed.

---

## 6. What Happens When a User Makes an API Call

This traces the full path of a protected request — say, the web app fetching a user's applications with `GET /applications`.

**Step 1 — The request leaves the browser.**
The web app sends `GET /api/applications` with `Authorization: Bearer <token>` in the header. Because `VITE_API_URL=/api` in production, Axios prepends `/api` to the path. This is a same-origin request (the web app and the gateway are served from the same domain via Caddy), so there is no CORS preflight.

**Step 2 — Caddy receives the request.**
Caddy is listening on port 443 (HTTPS). It matches the `/api/*` path pattern, strips the `/api` prefix using `uri strip_prefix /api`, and forwards the request to `localhost:3000` on the host. The request is now `GET /applications` heading into the gateway.

**Step 3 — Gateway: CORS check.**
The gateway's `cors()` middleware runs. For a same-origin request the `Origin` header matches the allowed origin, so it passes. For cross-origin requests (extension, mobile), the rules from Section 5 apply.

**Step 4 — Gateway: Helmet.**
`helmet()` adds security headers to the response (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.). Content-Security-Policy is disabled because this is a JSON API, not an HTML app.

**Step 5 — Gateway: Body parsing.**
`express.json({ limit: '100kb' })` runs. For a GET request the body is empty, so nothing changes. For POST/PUT requests, this parses the JSON body and puts it on `req.body`. If the body is larger than 100 KB, Express rejects it with 413 before the request reaches any route.

**Step 6 — Gateway: Route matching.**
The request path is `/applications`. The gateway checks its routes in order. It skips `/health` (wrong path), skips `/auth` (wrong prefix), skips `POST /users/me/resume` (wrong method and path), skips `/users` (wrong prefix), and matches `router.use('/applications', ...)`.

**Step 7 — Gateway: JWT verification (`requireAuth`).**
`requireAuth` reads `req.headers.authorization`. It checks the header exists and starts with `Bearer `. It slices off `Bearer ` and calls `jwt.verify(token, process.env.JWT_SECRET)`. If the token is valid, `jwt.verify` returns the decoded payload (which contains `sub` — the user's UUID — and `email`). The middleware then:
- Sets `req.user = payload`
- Sets `req.headers['x-user-id'] = payload.sub`
- Sets `req.headers['x-user-email'] = payload.email`
- Calls `next()`

If the token is expired, it returns `401 { message: 'Token expired' }`. If the token is invalid for any other reason, it returns `401 { message: 'Invalid token' }`. The request stops here and never reaches the rate limiter or the upstream service.

**Step 8 — Gateway: Rate limiting (`standardLimiter`).**
The rate limiter generates a key using `req.user.sub` (the user's UUID, set in step 7). It checks Redis for how many requests this user has made in the last 60 seconds. If the count is under 100, it increments the counter and calls `next()`. If the count is 100 or more, it returns `429 { message: 'Too many requests. Limit: 100 per minute.' }`. The response includes `RateLimit-*` headers so clients know when the window resets.

**Step 9 — Gateway: `forward()` sends the request upstream.**
The `forward(process.env.JOBS_SERVICE_URL)` function is called. It fires an Axios request to `http://jobs-service:3002/applications` (Docker's internal DNS resolves `jobs-service` to the jobs container's IP on `gbm-network`). It copies the headers from the incoming request — including `Authorization`, `x-user-id`, `x-user-email` — but strips `host` (to avoid confusing the upstream service) and `content-length` (so Axios can calculate the correct value after body serialisation). The timeout is 9 seconds.

**Step 10 — Jobs service receives the request.**
The jobs service's Express app receives `GET /applications`. Its own middleware stack runs (`express.json()` for body parsing). The request reaches `applicationRoutes` at `/applications`. The controller reads `req.headers['x-user-id']` (set by the gateway in step 7) to know which user's applications to fetch. It queries Postgres, builds a response array, and calls `res.json(applications)`.

**Step 11 — Response travels back through the gateway.**
Axios in the gateway receives the response from the jobs service. `validateStatus: () => true` means Axios treats any HTTP status as success (no throwing on 4xx/5xx). The gateway calls `res.status(upstream.status).json(upstream.data)` — it forwards the upstream status code and body verbatim.

**Step 12 — Caddy forwards the response to the browser.**
Caddy relays the response through the HTTPS connection to the browser. The browser receives a JSON array of applications with a `200 OK` status.

**Total hop count for a normal authenticated request:** browser → Caddy → gateway (CORS + JWT + rate limit) → backend service → gateway → Caddy → browser.

**What short-circuits this path:**
- Missing or expired JWT: stops at step 7, returns 401
- Rate limit exceeded: stops at step 8, returns 429
- Upstream service is down or too slow: step 9 catches the Axios timeout or connection error, returns 502
- Route not registered: falls through all route handlers to the 404 catch-all
