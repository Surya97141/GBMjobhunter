# GBMjobhunter — Complete Codebase Briefing

**Purpose:** Hand this document to a new Claude session for full context. It covers every service, every table, the async pipeline, the AI tier system, the design system, and all production hardening decisions made to date.

---

## 1. What This Project Is

**GBMjobhunter** is a job-search intelligence platform. It does three things:

1. **Tracks applications** — a Kanban board where users log jobs they've applied to, with status columns (saved → applied → interview → offer/ghosted/rejected).
2. **Generates AI insights** — every night the platform analyses anonymised cohort data (ghost rates, ATS scores, rejection rates by skill cluster and role bucket) and surfaces personalised cards on the dashboard.
3. **Auto-fills job applications** — a Chrome extension detects ATS forms (Greenhouse, Lever, Workday, etc.), fetches the user's profile and resume, and fills fields automatically.

There is also a React Native mobile app (Expo) for checking the dashboard on the go.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Web frontend | React 18, Vite, React Router v6, Framer Motion, CSS Modules |
| Mobile | React Native (Expo) |
| Chrome extension | MV3, vanilla JS (no build step) |
| API gateway | Node.js / Express |
| Backend services | Node.js / Express (×4) |
| Database | PostgreSQL 15 (single instance, all services) |
| Queue / cache | Redis 7 via BullMQ |
| AI — Tier 2 | Groq (llama-3.3-70b-versatile) — OpenAI-compatible API |
| AI — Tier 3 | Anthropic Claude (claude-haiku-4-5-20251001) via @anthropic-ai/sdk |
| Production hosting | Hetzner CX22 VPS, Docker Compose, Caddy (HTTPS + reverse proxy) |
| Package management | npm workspaces (monorepo) |

---

## 3. Monorepo Structure

```
GBMjobhunter/
├── gateway/                 Express API gateway (port 3000)
├── services/
│   ├── user/                Auth + profile service (port 3001)
│   ├── jobs/                Applications + jobs service (port 3002)
│   ├── opportunity/         Curated opportunities service (port 3003)
│   ├── intelligence/        Background analytics worker (no HTTP port)
│   └── agent/               AI model router service (port 3005)
├── web/                     React web app (Vite, port 5173 in dev)
├── mobile/                  React Native / Expo app
├── extension/               Chrome MV3 extension (no build step)
├── shared/                  Shared utility package
├── migrations/              12 sequential .sql files
├── scripts/
│   ├── migrate.js           Migration runner
│   ├── deploy.sh            VPS deploy script
│   └── setup-vps.sh         One-time VPS setup script
├── docker-compose.yml       Production Docker Compose (all 6 services + postgres + redis)
├── Caddyfile                Caddy config — HTTPS, static serve, /api/* proxy
├── .env.production          Secrets template (safe to commit, blanks filled on VPS)
└── package.json             Workspace root — npm run backend / npm run web
```

All backend services have `"start": "node index.js"` — the entry point is always `index.js` at the service root, NOT `src/index.js`.

---

## 4. API Gateway (port 3000)

**File:** `gateway/index.js`, `gateway/src/routes/proxy.routes.js`

The gateway is the only publicly-routable backend service. It handles:
- CORS (allows web dev server, any `chrome-extension://` origin, and `ALLOWED_ORIGINS` env var)
- JWT verification (via `gateway/src/middleware/auth.middleware.js`)
- Rate limiting (standard 100 req/min, resume upload has its own stricter limit)
- Helmet security headers

**Routing table:**
```
POST /auth/*          → user-service:3001   (public — no JWT)
GET  /auth/*          → user-service:3001   (public)
POST /users/me/resume → user-service:3001   (JWT required, raw stream proxy for multipart)
*    /users/*         → user-service:3001   (JWT required)
*    /applications/*  → jobs-service:3002   (JWT required)
*    /jobs/*          → jobs-service:3002   (JWT required)
*    /opportunities/* → opportunity-service:3003  (JWT required)
*    /agent/*         → agent-service:3005  (JWT required)
GET  /health          → { status: 'ok' }    (always 200, no JWT)
```

Two proxy strategies: `forward()` for JSON bodies (uses axios), `streamForward()` for multipart/form-data file uploads (pipes raw TCP stream, bypassing express body parser).

**Key env vars:** `JWT_SECRET`, `USER_SERVICE_URL`, `JOBS_SERVICE_URL`, `OPPORTUNITY_SERVICE_URL`, `AGENT_SERVICE_URL` (intelligence service has no gateway route — it's internal only), `REDIS_URL`, `ALLOWED_ORIGINS`

---

## 5. User Service (port 3001)

**File:** `services/user/index.js`

Handles authentication, profile management, and resume parsing.

**Routes:**
- `POST /auth/register` — creates user, hashes password with bcrypt, returns JWT
- `POST /auth/login` — verifies credentials, returns JWT
- `GET  /users/me` — returns profile + resume_json
- `PUT  /users/me` — updates name, target_role, cover_letter_template
- `POST /users/me/resume` — accepts PDF upload (multer), runs `pdf-parse`, stores extracted JSON in `resume_json` column

**Key dependencies:** `bcrypt`, `jsonwebtoken`, `multer`, `pdf-parse`, `pg`, `redis`, `zod`

**DB access:** `users` table only (via `src/db/users.db.js` and `src/db/pool.js`)

---

## 6. Jobs Service (port 3002)

**File:** `services/jobs/index.js`

Handles job applications tracking and skill demand data.

**Routes (applications):**
- `GET    /applications` — list user's applications
- `POST   /applications` — create application, fires BullMQ job to `application.logged` queue
- `PATCH  /applications/:id/status` — update Kanban column status
- `PATCH  /applications/:id/outcome` — set final outcome (ghosted/rejected/offer), fires to `outcome.updated` queue
- `DELETE /applications/:id`

**Routes (jobs):**
- `GET /jobs` — skill demand leaderboard (from `skill_demand` table)

**Key internal logic:**
- `src/services/ghostScore.service.js` — computes a ghost risk score per application using TF-IDF similarity between job description and user resume
- `src/utils/fingerprint.js` — deduplication fingerprint for applications
- `src/queues/producer.js` — BullMQ producer that emits to `application.logged` and `outcome.updated` queues

**Key dependencies:** `bullmq`, `pg`, `redis`, `zod`, `uuid`

---

## 7. Opportunity Service (port 3003)

**File:** `services/opportunity/index.js`

Serves curated non-job opportunities: online courses, communities, and skill paths. No user writes — read-only from static data files and the `cohort_patterns` table.

**Routes:**
- `GET /opportunities` — returns combined courses, communities, skill paths, filtered/sorted by user's skill cluster from cohort patterns

**Key files:**
- `src/data/courses.js`, `src/data/communities.js`, `src/data/skillPaths.js` — static curated data
- `src/db/cohortPatterns.db.js` — reads pattern data to personalise results
- `src/services/communities.service.js`, `src/services/opportunities.service.js`

---

## 8. Intelligence Service (background worker — no HTTP port)

**File:** `services/intelligence/index.js`

Pure background worker. Listens to BullMQ queues and runs the nightly analytics pipeline. Has no HTTP server.

**Startup check:** requires `DATABASE_URL` and `REDIS_URL` env vars. Throws on boot if missing.

**BullMQ consumers (`src/queues/consumers.js`):**

| Queue | Trigger | Action |
|---|---|---|
| `application.logged` | New application created | Strips PII → inserts into `application_events` table |
| `outcome.updated` | Application outcome set | Updates `application_events.outcome` and `response_days` |
| `pattern.computed` | Nightly job completes | Calls `publishInsightsForPatterns()` → writes to `user_insights` |
| `nightly-computation` | Cron at midnight UTC | Runs `runNightlyComputation()` + `computeSkillImpactPatterns()`, then fires `pattern.computed` |

**Analytics pipeline (`src/services/`):**
- `piiStripping.js` — strips user identifiers before storing, keeps role/skill/ATS data
- `clickhouseWriter.service.js` — despite the filename, NOW WRITES TO POSTGRES (was ClickHouse; migrated). Contains `insertApplicationEvent()` (DO NOTHING on conflict — critical for BullMQ at-least-once retries) and `updateApplicationOutcome()`
- `patternComputation.service.js` — groups `application_events` by skill_cluster/role_bucket/ats_platform, computes ghost_rate/rejection_rate/avg_ats_score using `COUNT(*) FILTER (WHERE ...)` (Postgres syntax). Minimum cohort size: 50. Writes to `cohort_patterns`
- `insightPublisher.service.js` — for each pattern, generates headline + action text, fans out to all matched users, writes to `user_insights`
- `diagnosticGenerator.service.js` — generates template-based diagnostic text (source='templated')
- `skillImpact.service.js` — computes skill impact patterns, writes separate pattern_type rows to `cohort_patterns`

**Key implementation note:** `application_events` uses `ON CONFLICT (application_id) DO NOTHING` in `insertApplicationEvent`. This is intentional — BullMQ has at-least-once delivery, so retries would otherwise overwrite real outcomes (e.g. 'ghosted') back to 'pending'. DO NOTHING is correct.

**Key dependencies:** `bullmq`, `pg`, `axios`, `uuid`

---

## 9. Agent Service (port 3005)

**File:** `services/agent/index.js`

AI model router. Exposes a unified interface to Tier 2 (Groq) and Tier 3 (Anthropic Claude) models.

**Routes:**
- `POST /agent/call` — routes to appropriate tier, enforces per-user Tier 3 quota

**AI Tier system (`src/services/modelRouter.service.js`):**

| Tier | Provider | Model | Use case |
|---|---|---|---|
| Tier 1 | None — client-side or DB query | N/A | Fast lookups, simple classification |
| Tier 2 | Groq (OpenAI-compatible) | `llama-3.3-70b-versatile` | Resume parsing, job matching, field extraction |
| Tier 3 | Anthropic | `claude-haiku-4-5-20251001` | Deep diagnostics, cover letter generation |

Tier 3 has a per-user daily quota (default 50 calls/day) enforced via Redis sorted sets. Quota resets at midnight UTC.

`callModel('tier1', ...)` throws immediately by design — Tier 1 tasks have no external API call to make.

**Key env vars:** `TIER2_API_BASE`, `TIER2_API_KEY`, `TIER2_MODEL_NAME`, `TIER3_API_KEY`, `TIER3_MODEL`, `TIER3_QUOTA_PER_DAY`, `MODEL_TIMEOUT_MS`

**Key dependencies:** `@anthropic-ai/sdk`, `express`, `pg`, `redis`, `zod`

---

## 10. Database Schema (PostgreSQL)

**Migration runner:** `scripts/migrate.js` — reads `migrations/*.sql` in alphabetical order, tracks applied files in a `migrations` table, all migrations are idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

**12 migrations:**

| File | Creates/Alters |
|---|---|
| `001_create_extensions.sql` | `uuid-ossp` extension |
| `002_create_users.sql` | `users` table (id, email, password_hash, resume_json, target_role, name, cover_letter_template, etc.) |
| `003_create_companies.sql` | `companies` table |
| `004_create_applications.sql` | `applications` table (user_id FK, company_id FK, status, outcome, ats_score, ghost_score, etc.) |
| `005_create_cohort_patterns.sql` | `cohort_patterns` table (role_bucket, skill_cluster, pattern_type, finding JSONB, cohort_size) |
| `006_create_user_insights.sql` | `user_insights` table (user_id FK, pattern_id FK, headline, action, source) |
| `007_create_skill_demand.sql` | `skill_demand` table |
| `008_add_missing_indices.sql` | Indices on user_insights(user_id), applications(user_id), cohort_patterns(role_bucket, skill_cluster) |
| `009_add_user_profile_fields.sql` | Adds `name`, `target_role` columns to `users` |
| `010_add_cover_letter_template.sql` | Adds `cover_letter_template TEXT` to `users` |
| `011_add_insight_source.sql` | Adds `source VARCHAR DEFAULT 'templated'` to `user_insights` |
| `012_create_application_events.sql` | `application_events` table (anonymised analytics: application_id PK, role_bucket, skill_cluster, ats_score, outcome, etc.) |

**Connection pattern:** every service has its own `src/db/pool.js` that creates a `new Pool({ connectionString: process.env.DATABASE_URL })`. All services share the same database instance.

---

## 11. BullMQ Async Pipeline

Redis is the backbone. All queue names:

```
application.logged      jobs-service produces → intelligence-service consumes
outcome.updated         jobs-service produces → intelligence-service consumes
nightly-computation     intelligence scheduler produces → intelligence consumes
pattern.computed        intelligence nightly worker produces → intelligence consumes
```

The full flow when a user submits an application:
1. `POST /applications` → jobs-service creates DB row → publishes to `application.logged`
2. intelligence consumer receives job → strips PII → inserts into `application_events` (with DO NOTHING guard)
3. Nightly at midnight UTC → scheduler fires `nightly-computation` → `runNightlyComputation()` groups events, writes `cohort_patterns` → fires `pattern.computed`
4. `pattern.computed` consumer → `publishInsightsForPatterns()` → writes `user_insights` rows for matched users

---

## 12. Web Frontend

**Stack:** React 18 + Vite + React Router v6 + Framer Motion (page transitions) + CSS Modules

**Routes (`web/src/App.jsx`):**
```
/                → LandingPage (public)
/login           → LoginPage (public)
/register        → RegisterPage (public)
/dashboard       → DashboardLayout (protected, requires JWT)
  /dashboard/         → DashboardPage (ATS ring, insight cards, world globe)
  /dashboard/tracker  → KanbanPage (drag-and-drop application board)
  /dashboard/insights → InsightsPage (full insight card feed)
  /dashboard/profile  → ProfilePage (resume upload, profile edit)
  /dashboard/opportunities → OpportunitiesPage (courses, communities, skill paths)
```

**Auth:** `web/src/context/AuthContext.jsx` — stores JWT in localStorage, provides `useAuth()` hook. `ProtectedRoute.jsx` redirects to `/login` if no token.

**API client:** `web/src/api/client.js`
```js
baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
// Production: VITE_API_URL=/api (relative, Caddy handles /api/* → gateway)
```

**Key UI components:**
- `DashboardLayout.jsx` — sidebar + outlet wrapper
- `ATSRing.jsx` — animated SVG ring showing ATS score
- `InsightCards.jsx` — scrollable insight card deck
- `WorldGlobe.jsx` — Three.js globe with react-globe.gl
- `KanbanCard.jsx` / `KanbanColumn.jsx` — drag-and-drop via @hello-pangea/dnd

---

## 13. Design System (Phase I — Complete)

**Three themes:** `obsidian` (dark, default), `cream` (warm light), and an `extension` theme. Set via `data-theme` attribute on root element. `web/src/context/ThemeContext.jsx` manages switching.

**CSS variables (`web/src/styles/themes.css`):** Each theme defines the full token set:
- `--bg-primary`, `--bg-surface`, `--bg-card`, `--bg-overlay`
- `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`
- `--accent`, `--accent-hover`, `--accent-subtle`
- `--color-high/mid/low` + subtle variants (green/amber/red semantic colours)
- `--font-heading` (Playfair Display, serif), `--font-body` (Inter, sans-serif)
- Spacing scale: `--space-1` (4px) through `--space-8` (64px)
- Radius: `--radius-sm/md/lg` (6/10/16px)
- Z-index: `--z-dropdown/modal/toast` (100/200/300)

**Typography component (`web/src/components/Typography.jsx`):**
Factory function `makeVariant(baseClass, defaultTag, displayName)` exports:
```js
Hero       // t-hero,    default h1 — Playfair Display italic in obsidian
Display    // t-display, default h2
Heading    // t-heading, default h3
Subheading // t-subheading, default h4
Body       // t-body,    default p
Small      // t-small,   default p
Label      // t-label,   default span
Micro      // t-micro,   default span
```
All accept `as` prop (polymorphic), `color` prop ('secondary'|'muted'|'accent'|'high'|'mid'|'low'), `className` for overrides.

**CSS loading order rule (critical):** CSS Modules load after global CSS in Vite's bundle. Module-scoped properties win over same-specificity global classes. Use `<Display as="h1">` (not a raw `<h1 className={styles.title}>`) for page titles — it applies the correct Playfair Display italic from `typography.css` in obsidian theme.

---

## 14. Chrome Extension

**File structure:** `extension/src/` — no build step. Loaded unpacked in Chrome directly.

**Manifest:** MV3. Service worker at `src/background/index.js`. Popup at `src/popup/index.html`. Content script at `src/content/index.js`.

**Config (`extension/src/config.js`):**
```js
const API_BASE    = 'http://localhost:3000';  // swap to production gateway URL
const WEB_APP_URL = 'http://localhost:5173';  // swap to production web URL
```
This is the single file to change before packaging for distribution. Both `background/index.js` (via `importScripts('../config.js')`) and `popup/index.html` (via `<script src="../config.js">` before `popup.js`) load it as globals.

**Note for production packaging:** Also update `manifest.json`:
- `externally_connectable.matches` → replace localhost URL with production web app URL
- `host_permissions` → replace `http://localhost/*` with production gateway domain

---

## 15. Mobile (React Native / Expo)

**File:** `mobile/src/api/client.js`
```js
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
```
`EXPO_PUBLIC_API_URL` is baked at EAS build time. For local dev on a physical device, set it to your machine's LAN IP. Mobile and extension are NOT deployed to the VPS — they connect to the VPS API remotely.

---

## 16. Production Hardening (completed)

These changes were made in the production hardening phase. All are already in the codebase:

1. **`web/src/api/client.js`** — removed hardcoded `http://localhost:3000`, now reads `VITE_API_URL`
2. **`gateway/.env.example`** — documents all required env vars including `ALLOWED_ORIGINS`
3. **`extension/src/config.js`** (new file) — single production swap point for extension URLs
4. **`extension/src/background/index.js`** — removed local `API_BASE` constant, uses `importScripts('../config.js')`
5. **`extension/src/popup/popup.js`** — removed local constants, uses `config.js` globals
6. **`extension/src/popup/index.html`** — added `<script src="../config.js">` before `popup.js`
7. **ClickHouse → Postgres migration** — `services/intelligence/src/services/clickhouseWriter.service.js` now writes to Postgres, `patternComputation.service.js` uses `COUNT(*) FILTER (WHERE ...)` syntax, `services/intelligence/index.js` no longer requires `CLICKHOUSE_URL`
8. **Migration 012** (`migrations/012_create_application_events.sql`) — replaces ClickHouse table
9. **`mobile/src/api/client.js`** — reads `EXPO_PUBLIC_API_URL` env var

**Why ClickHouse was removed:** One table, two write patterns, one query — no exotic analytics features needed ClickHouse's power. Postgres does this with standard SQL.

---

## 17. VPS Deployment Setup (Hetzner CX22)

**Target:** Hetzner CX22 (2 vCPU, 4 GB RAM, Ubuntu 22.04), ~€3.79/month.

**Architecture on VPS:**
```
Internet → Caddy (80/443) → /api/* → localhost:3000 (gateway)
                          → /*     → /var/www/gbm/web/dist (static files)

Docker (internal gbm-network):
  gateway (127.0.0.1:3000) → user-service:3001
                            → jobs-service:3002
                            → opportunity-service:3003
                            → agent-service:3005
                            ↑ (all services share)
  postgres (127.0.0.1:5432) ← migrations run on host via localhost:5432
  redis (internal only, no host port)
  intelligence-service (background worker, no port)
```

**Key architectural decision:** `VITE_API_URL=/api` (relative). Caddy serves both the static web app AND proxies `/api/*` to the gateway on the same domain. No absolute URL needed in the bundle. Caddy strips the `/api` prefix before forwarding (`uri strip_prefix /api`) because gateway routes have no `/api` prefix.

**Files produced (all committed in repo):**
- `docker-compose.yml` — all 8 containers, `gbm-network`, named volumes, health checks
- `gateway/Dockerfile`, `services/*/Dockerfile` — 6 Dockerfiles, all `CMD ["node", "index.js"]`
- `.env.production` — template with non-secret defaults filled in, secrets blank
- `Caddyfile` — HTTPS, SPA fallback (`try_files {path} /index.html`), `/api/*` proxy
- `scripts/setup-vps.sh` — Docker + Caddy + Node 20 + UFW install
- `scripts/deploy.sh` — git pull + `npm run build` + `docker compose up -d --build` + migrate + Caddy reload

**IMPORTANT before first deploy:**
1. Create `.dockerignore` in each of the 6 service directories containing `node_modules` and `.env` — without this, Windows-compiled native modules (bcrypt) will be copied into Linux containers and crash
2. Edit `Caddyfile` — replace `your-domain.com` with the real domain
3. Copy `.env.production` to `.env` on the VPS and fill in 5 secrets: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ALLOWED_ORIGINS` (your domain URL), `TIER2_API_KEY`, `TIER3_API_KEY`

---

## 18. Environment Variables Reference

**All services share:**
- `DATABASE_URL` — Postgres connection string. In Docker Compose, constructed as `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`
- `REDIS_URL` — `redis://redis:6379` in Docker, `redis://127.0.0.1:6380` in local dev
- `JWT_SECRET` — must be identical across gateway and all services
- `NODE_ENV` — `production` on VPS

**Gateway only:** `USER_SERVICE_URL`, `JOBS_SERVICE_URL`, `OPPORTUNITY_SERVICE_URL`, `AGENT_SERVICE_URL`, `ALLOWED_ORIGINS`

**Agent only:** `TIER2_API_BASE`, `TIER2_API_KEY`, `TIER2_MODEL_NAME`, `TIER3_API_KEY`, `TIER3_MODEL`, `TIER3_QUOTA_PER_DAY`, `MODEL_TIMEOUT_MS`

**Intelligence only:** `FCM_SERVER_KEY` (optional, push notifications)

**Postgres container:** `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

---

## 19. Local Development

```bash
# 1. Start postgres + redis (dev uses different ports to avoid conflicts)
npm run dev  # docker-compose up -d (postgres on 5433, redis on 6380, no ClickHouse)

# 2. Run migrations
npm run migrate

# 3. Start all 6 backend services with hot reload
npm run backend  # concurrently with colour-coded output

# 4. Start web dev server (separate terminal)
npm run web  # Vite on http://localhost:5173
```

Dev postgres uses port 5433 (not 5432) to avoid conflicts with any local postgres.
Dev redis uses port 6380.
Local `.env` files in each service directory (not committed).

---

## 20. Known Items / What's Next

1. **`.dockerignore` files** — must be created before first `docker compose build` or native modules will break. One-liner: `for d in gateway services/user services/jobs services/opportunity services/intelligence services/agent; do echo -e "node_modules\n.env\n*.log" > $d/.dockerignore; done`

2. **Extension production packaging** — update `extension/src/config.js` with VPS domain, update `manifest.json` externally_connectable matches and host_permissions, then `zip -r extension.zip extension/` for distribution

3. **Mobile production build** — set `EXPO_PUBLIC_API_URL=https://your-domain.com/api` in the EAS build profile, then `eas build`

4. **Root `package.json` scripts** — `setup:clickhouse` script and `@clickhouse/client` devDependency still reference the old ClickHouse setup. These can be cleaned up (the service itself no longer uses ClickHouse; only the root-level dev tooling references it)

5. **SSL/TLS first boot** — Caddy will attempt to obtain a Let's Encrypt certificate on first start. DNS A record must point to the VPS IP **before** starting Caddy, or the ACME challenge will fail and Caddy will fall back to HTTP
