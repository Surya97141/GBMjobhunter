# Notebook 6 — DevOps: Deployment, Docker, Migrations, and the Dev Loop

---

## 1. The VPS Architecture

### The machine

The target is a Hetzner CX22: 2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 22.04. That is the minimum footprint — Postgres, Redis, six Node.js services, and Caddy all running simultaneously.

### What runs where

Everything user-facing traffic reaches goes through Docker, except the static frontend files and Caddy itself.

**On the host OS directly (not in Docker):**
- **Caddy** — reverse proxy and HTTPS terminator. Installed as a systemd service. Listens on ports 80 and 443. Caddy is outside Docker so it can manage TLS certificates via Let's Encrypt without any container networking complications.
- **Node.js 20** — installed on the host, but only used for running migrations (`node scripts/migrate.js`). Not used to serve anything permanently.
- **The static frontend** — the built React app lives at `/var/www/gbm/web/dist`. Caddy serves these files directly from disk with no intermediary.

**In Docker (via docker compose):**
- `postgres` — PostgreSQL 15 on the internal network. Port 5432 is bound to `127.0.0.1` only, so it's reachable from the host for migrations but not from the internet.
- `redis` — Redis 7 on the internal network. No host port exposed at all.
- `gateway` — the API gateway. Port 3000 is bound to `127.0.0.1` only. Caddy proxies to it.
- `user-service` — port 3001, internal network only.
- `jobs-service` — port 3002, internal network only.
- `opportunity-service` — port 3003, internal network only.
- `agent-service` — port 3005, internal network only.
- `intelligence-service` — no port at all. Background worker only.

**UFW firewall rules:**
- Port 22 (SSH) — allowed
- Port 80 (HTTP) — allowed (Caddy uses this for ACME HTTP challenge and redirects to HTTPS)
- Port 443 (HTTPS) — allowed
- Everything else — blocked by default, including 3000 (gateway) and 5432 (postgres), which are bound to `127.0.0.1` anyway

### The full request path

Here is the complete path for a browser request to `https://your-domain.com/api/users/me`:

```
1. Browser resolves your-domain.com → VPS IP via DNS.

2. TCP SYN hits the VPS on port 443.

3. UFW allows port 443, passes to Caddy.

4. Caddy handles TLS termination. The connection is now plain HTTP internally.

5. Caddy matches the request path /api/users/me against handle /api/*.
   Caddy strips the /api prefix → /users/me.
   Caddy forwards to http://localhost:3000/users/me.

6. The gateway container receives the request on port 3000.
   The gateway:
   a. Checks the JWT in the Authorization header (if route requires auth).
   b. Matches the route /users/me → user-service.
   c. Forwards to http://user-service:3001/users/me over gbm-network.

7. The user-service container receives the request on port 3001.
   It queries postgres:5432 on gbm-network.
   Returns the response to the gateway.

8. The gateway forwards the response back to Caddy.

9. Caddy forwards the response to the browser with TLS.
```

For a browser request to `https://your-domain.com/dashboard` (a React route):

```
1–4. Same as above.

5. Caddy does NOT match handle /api/* (path is /dashboard, not /api/*).
   Falls through to the catch-all handle block.
   Caddy looks for /var/www/gbm/web/dist/dashboard — file does not exist.
   try_files {path} /index.html — falls back to index.html.
   Caddy serves /var/www/gbm/web/dist/index.html.

6. Browser loads index.html + the bundled React JS.
   React Router reads window.location.pathname (/dashboard).
   Renders DashboardPage without any server round-trip.
```

---

## 2. Every Dockerfile

All six Dockerfiles follow the same structure. This is intentional — every Node.js service is a self-contained Express app with the same shape.

### The template

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE <port>
CMD ["node", "index.js"]
```

### Step-by-step explanation

**`FROM node:20-alpine`**

Alpine Linux is a minimal base image (~5 MB). The `node:20-alpine` image ships Node.js 20 LTS on Alpine. Small image = faster pulls, smaller attack surface. The tradeoff: Alpine uses musl libc instead of glibc. Most pure-JS packages work fine. Native modules (bcrypt, argon2) must compile against musl, which is handled by `npm ci` inside the container. This is why `.dockerignore` is non-negotiable (see Section 3).

**`WORKDIR /app`**

Sets the working directory inside the container. All subsequent commands run from `/app`. The node process can find `index.js` at `/app/index.js`.

**`COPY package*.json ./`**

Copies `package.json` and `package-lock.json` first, before copying source code. This is a Docker layer caching optimisation. Docker builds layer by layer. If `package*.json` hasn't changed, Docker reuses the cached layer from the previous build — including the next `npm ci` step. Source code changes (which happen every deploy) don't invalidate the dependency install layer. Result: subsequent deployments that don't add new packages complete `npm ci` in seconds instead of minutes.

**`RUN npm ci --omit=dev`**

`npm ci` — not `npm install`. `npm ci` is the production install command: it uses `package-lock.json` exactly (no version resolution), fails if `package-lock.json` is missing or out of sync with `package.json`, and deletes any existing `node_modules` first. `--omit=dev` is the npm 10 way of saying `--only=production` — excludes devDependencies (nodemon, jest, etc.) to keep the image small.

**`COPY . .`**

Copies all remaining files from the service directory into `/app`. This is where `.dockerignore` matters — without it, this step would copy the host's `node_modules` on top of the correctly compiled Alpine ones (see Section 3).

**`EXPOSE <port>`**

Documents which port the container listens on. Not a firewall rule — purely documentation. Docker Compose uses this for reference but doesn't enforce it.

**`CMD ["node", "index.js"]`**

Starts the service. **The entry point is always `index.js` at the root of the service directory** — not `src/index.js`, not `dist/index.js`. This is confirmed by the `"main": "index.js"` field in `gateway/package.json` and matches the `"start": "node index.js"` script in each service. The array form (`["node", "index.js"]`) is exec form — it runs node directly as PID 1, not through a shell. This means SIGTERM from `docker compose down` reaches the Node.js process directly, enabling graceful shutdown.

### Per-service ports and notable differences

| Service | EXPOSE port | Notes |
|---------|-------------|-------|
| `gateway` | 3000 | Only service with a host-visible port (`127.0.0.1:3000:3000`) |
| `user-service` | 3001 | Internal only |
| `jobs-service` | 3002 | Internal only |
| `opportunity-service` | 3003 | Internal only |
| `agent-service` | 3005 | Internal only. Has extra AI env vars |
| `intelligence-service` | none | No EXPOSE, no PORT env var. Background worker; never receives HTTP connections |

The intelligence-service Dockerfile has a comment: `# Background worker — no HTTP port. Communicates via BullMQ/Redis.` It connects to Redis on startup and processes BullMQ queues continuously. Giving it an EXPOSE would be misleading — there is no server to expose.

---

## 3. The .dockerignore Requirement

### The problem

**No `.dockerignore` files exist in this repo.** There is no `.dockerignore` in `gateway/`, `services/user/`, `services/jobs/`, `services/opportunity/`, `services/agent/`, or `services/intelligence/`.

This means when `docker compose build` runs `COPY . .` inside each Dockerfile, Docker copies the entire service directory into the image — **including any `node_modules/` directory that already exists on the developer's machine**.

The Dockerfile runs `npm ci --omit=dev` first, which correctly installs all native dependencies compiled for Alpine Linux (musl libc). Then `COPY . .` runs and overwrites `/app/node_modules` with whatever the host machine has.

On macOS, that's `node_modules` compiled for macOS (Darwin arm64 or x86_64). On Windows, it's compiled for Windows. On Ubuntu with glibc, it's compiled for glibc. **None of these work inside Alpine Linux**, which uses musl libc.

### What breaks

The service that breaks is `user-service`, which uses **bcrypt** for password hashing. bcrypt is a native module — it includes a `.node` binary file compiled in C++ for a specific OS and libc. If the host's `bcrypt.node` lands in the container, Node.js tries to load it and fails:

```
Error: /app/node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node:
  invalid ELF header
```

or on some systems:
```
Error: /lib/x86_64-linux-musl/libc.musl-x86_64.so.1: cannot open shared object file
```

The service starts, then crashes immediately when it tries to require bcrypt. The health check never passes. Docker Compose sees the container repeatedly exit and restart.

### The fix

Create a file named `.dockerignore` in every service directory that has a Dockerfile, containing at minimum:

```
node_modules
```

With `.dockerignore` present, the `COPY . .` instruction ignores the host's `node_modules` directory. Only source files are copied. The `/app/node_modules` that `npm ci` installed (compiled for Alpine) survives intact.

**One-liner to create all six files:**

```bash
for dir in gateway services/user services/jobs services/opportunity services/agent services/intelligence; do
  echo "node_modules" > "$dir/.dockerignore"
done
```

Run this from the repo root before the first `docker compose build`. It is safe to run it again — it overwrites with the same content.

**You should also add a `.gitignore` entry** so these files don't accidentally get committed with wrong content:

Actually, the `.dockerignore` files should be committed to the repo so future developers don't have this problem. Add them to git:

```bash
git add gateway/.dockerignore services/user/.dockerignore services/jobs/.dockerignore \
        services/opportunity/.dockerignore services/agent/.dockerignore \
        services/intelligence/.dockerignore
git commit -m "Add .dockerignore to all service directories"
```

---

## 4. docker-compose.yml Explained

### Network

```yaml
networks:
  gbm-network:
    driver: bridge
```

One bridge network named `gbm-network`. All services join it. Within this network, services resolve each other by their service name. So `user-service` can reach `postgres` at `postgres:5432`, and the gateway can reach `user-service` at `user-service:3001`. These hostnames are Docker's internal DNS — they only work inside the `gbm-network`.

### Named volumes

```yaml
volumes:
  postgres-data:
  redis-data:
```

Two named volumes managed by Docker. Data stored here survives `docker compose down` and even `docker compose down` followed by `docker compose up`. The data is **not** inside the container — it is stored in Docker's volume area (`/var/lib/docker/volumes/` on the host).

**Warning:** `docker compose down -v` deletes named volumes. This destroys all Postgres data and all Redis data. Never run `down -v` on a production server unless you intend to wipe the database.

### postgres

```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_DB:       ${POSTGRES_DB}
    POSTGRES_USER:     ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  volumes:
    - postgres-data:/var/lib/postgresql/data
  networks:
    - gbm-network
  ports:
    - "127.0.0.1:5432:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 5
  restart: unless-stopped
```

- **Image:** postgres:15-alpine — Alpine-based, minimal.
- **Environment:** The three Postgres bootstrap variables. These only take effect on the first startup when the `postgres-data` volume is empty. Postgres initialises the database with these credentials. Changing them after first run has no effect without resetting the volume.
- **Volume:** `postgres-data:/var/lib/postgresql/data` — persists all database files.
- **Port:** `127.0.0.1:5432:5432` — only the loopback interface. The gateway and other services reach Postgres via the internal `gbm-network` hostname `postgres:5432` (no host port needed for that). The host port exists for one purpose: running `node scripts/migrate.js` on the host, which connects to `localhost:5432`.
- **Health check:** Runs `pg_isready` inside the postgres container every 5 seconds, up to 5 times. Other services have `depends_on: postgres: condition: service_healthy` — they do not start until this health check passes. This prevents services from crashing because they tried to connect to Postgres before it finished initialising.
- **restart: unless-stopped:** Container restarts automatically after any crash, unless you explicitly stopped it with `docker compose stop`.

### redis

```yaml
redis:
  image: redis:7-alpine
  volumes:
    - redis-data:/data
  networks:
    - gbm-network
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5
  restart: unless-stopped
```

No host port. Redis is only reachable internally as `redis:6379`. The health check runs `redis-cli ping` — Redis responds `PONG` when ready. All services specify `depends_on: redis: condition: service_healthy`.

### gateway

```yaml
gateway:
  build: ./gateway
  ports:
    - "127.0.0.1:3000:3000"
  environment:
    PORT:                    3000
    NODE_ENV:                ${NODE_ENV}
    JWT_SECRET:              ${JWT_SECRET}
    REDIS_URL:               redis://redis:6379
    USER_SERVICE_URL:        http://user-service:3001
    JOBS_SERVICE_URL:        http://jobs-service:3002
    OPPORTUNITY_SERVICE_URL: http://opportunity-service:3003
    AGENT_SERVICE_URL:       http://agent-service:3005
    ALLOWED_ORIGINS:         ${ALLOWED_ORIGINS}
  networks:
    - gbm-network
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  restart: unless-stopped
```

- **build: ./gateway** — builds the image from `gateway/Dockerfile`. Docker caches this.
- **port 3000 on 127.0.0.1** — Caddy connects here. Not internet-facing directly.
- **REDIS_URL** is hardcoded to `redis://redis:6379` — the internal Docker DNS name. Not substituted from `.env`.
- **Service URLs** are all hardcoded internal Docker DNS names. The gateway uses these to proxy requests to the right service.
- **ALLOWED_ORIGINS** comes from `.env`. This must be set to your production domain, e.g. `https://your-domain.com`. The gateway's CORS middleware uses this. Wrong value = CORS errors in the browser.

### user-service, jobs-service, opportunity-service

These three follow the same pattern:

```yaml
user-service:
  build: ./services/user
  environment:
    PORT:         3001
    NODE_ENV:     ${NODE_ENV}
    JWT_SECRET:   ${JWT_SECRET}
    DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    REDIS_URL:    redis://redis:6379
  networks:
    - gbm-network
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  restart: unless-stopped
```

No host ports. Internal-only. `DATABASE_URL` is constructed in the compose file using the three `POSTGRES_*` variables: `postgresql://gbmuser:yourpassword@postgres:5432/gbmjobhunter`. The hostname `postgres` here is the internal Docker DNS name — it resolves to the postgres container's internal IP on `gbm-network`.

### intelligence-service

```yaml
intelligence-service:
  build: ./services/intelligence
  environment:
    NODE_ENV:       ${NODE_ENV}
    JWT_SECRET:     ${JWT_SECRET}
    DATABASE_URL:   postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    REDIS_URL:      redis://redis:6379
    FCM_SERVER_KEY: ${FCM_SERVER_KEY}
  networks:
    - gbm-network
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  restart: unless-stopped
```

Note: **no `PORT` environment variable**. The intelligence service has no HTTP server — it is a background worker that connects to BullMQ (via Redis) and Postgres, then runs continuously processing queues. It never listens for connections.

`FCM_SERVER_KEY` is optional — if left blank in `.env`, push notifications are silently disabled.

### agent-service

```yaml
agent-service:
  build: ./services/agent
  environment:
    PORT:                3005
    NODE_ENV:            ${NODE_ENV}
    JWT_SECRET:          ${JWT_SECRET}
    DATABASE_URL:        postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    REDIS_URL:           redis://redis:6379
    TIER2_API_BASE:      ${TIER2_API_BASE}
    TIER2_API_KEY:       ${TIER2_API_KEY}
    TIER2_MODEL_NAME:    ${TIER2_MODEL_NAME}
    TIER3_API_KEY:       ${TIER3_API_KEY}
    TIER3_MODEL:         ${TIER3_MODEL}
    TIER3_QUOTA_PER_DAY: ${TIER3_QUOTA_PER_DAY}
    MODEL_TIMEOUT_MS:    ${MODEL_TIMEOUT_MS}
  networks:
    - gbm-network
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  restart: unless-stopped
```

All AI-related variables come from `.env`. The service starts even if `TIER2_API_KEY` and `TIER3_API_KEY` are blank — it just returns `{ success: false, error: 'not_configured' }` for those tiers. This allows the system to run with no AI keys and add them later without rebuilding.

---

## 5. Caddy Configuration

The full Caddyfile:

```
your-domain.com {

    handle /api/* {
        uri strip_prefix /api
        reverse_proxy localhost:3000
    }

    handle {
        root * /var/www/gbm/web/dist
        try_files {path} /index.html
        file_server
    }
}
```

### How HTTPS is provisioned automatically

Caddy implements the ACME protocol natively. When it sees `your-domain.com { }` in the Caddyfile and starts up, it:

1. Checks whether it already has a valid TLS certificate for that domain in its certificate store (`/var/lib/caddy/.local/share/caddy/` by default).
2. If not (first boot), it makes an HTTP request to Let's Encrypt, completes the HTTP-01 challenge (this is why port 80 must be open in UFW), and obtains a certificate.
3. Stores the certificate locally and serves HTTPS on port 443.
4. Automatically renews the certificate before it expires.

**The DNS prerequisite:** The domain's A record must point to the VPS IP address before Caddy first starts. Let's Encrypt verifies ownership by making a request to `http://your-domain.com/.well-known/acme-challenge/...`. If DNS hasn't propagated yet, this request doesn't reach the VPS, the challenge fails, and Caddy cannot get a certificate. Caddy will log the failure and retry with exponential backoff, but HTTPS will not work until the certificate is issued.

**How to check DNS propagation:**
```bash
dig +short your-domain.com A
# Should return your VPS IP
```

### How `/api/*` is proxied to the gateway

Caddy evaluates `handle` blocks from top to bottom. The first `handle /api/*` block matches any path that starts with `/api/`.

Inside this block:
1. `uri strip_prefix /api` — removes the `/api` prefix from the request path. A request for `/api/auth/login` becomes `/auth/login`.
2. `reverse_proxy localhost:3000` — forwards the modified request to the gateway.

**Why the strip_prefix is essential:** The gateway defines routes without an `/api` prefix — it has `/auth/login`, `/users/me`, `/jobs`, and so on. If Caddy forwarded `/api/auth/login` to the gateway unchanged, the gateway would see `/api/auth/login` and find no matching route. The result would be a 404 from the gateway, not an auth error. The strip happens before the reverse proxy, so the gateway always sees clean paths.

### How the SPA fallback works

The catch-all `handle` block (no path matcher — matches everything not matched by the `/api/*` block):

1. `root * /var/www/gbm/web/dist` — tells Caddy where static files live.
2. `try_files {path} /index.html` — this is the SPA magic. Caddy first tries to find the request path as an actual file. For `GET /assets/index-xyz.js`, the file exists at `/var/www/gbm/web/dist/assets/index-xyz.js` and is served. For `GET /dashboard`, no file exists at that path, so Caddy falls back to `/index.html`.
3. `file_server` — serves the file.

React Router handles everything after that: it reads `window.location.pathname`, matches it to a route in `App.jsx`, and renders the correct component. The server never sees `/dashboard` as a resource request — only as "give me index.html so React can run."

---

## 6. All Environment Variables

Complete reference. Variables are read from `.env` (Docker Compose substitution using `${VAR}` syntax). Secrets must never be committed.

| Variable | Services that use it | What it does | Example value | Secret? |
|----------|---------------------|--------------|---------------|---------|
| `POSTGRES_DB` | postgres (init), all services (via DATABASE_URL) | Name of the Postgres database | `gbmjobhunter` | No |
| `POSTGRES_USER` | postgres (init), all services (via DATABASE_URL) | Postgres username | `gbmuser` | No |
| `POSTGRES_PASSWORD` | postgres (init), all services (via DATABASE_URL) | Postgres password | *(blank in template)* | **Yes** |
| `NODE_ENV` | gateway, all services | Sets Express to production mode (disables error stack traces in responses, enables trust proxy) | `production` | No |
| `JWT_SECRET` | gateway, user-service, and any service that verifies JWTs | HMAC key for signing and verifying JWTs. Must be identical across all services. | *(blank in template)* | **Yes** |
| `ALLOWED_ORIGINS` | gateway | Comma-separated list of origins allowed by the CORS middleware | `https://your-domain.com` | No |
| `TIER2_API_BASE` | agent-service | Base URL for the Tier 2 model provider (OpenAI-compatible) | `https://api.groq.com/openai/v1` | No |
| `TIER2_API_KEY` | agent-service | API key for the Tier 2 provider | *(blank in template)* | **Yes** |
| `TIER2_MODEL_NAME` | agent-service | Model identifier sent to the Tier 2 provider | `llama-3.3-70b-versatile` | No |
| `TIER3_API_KEY` | agent-service | Anthropic API key for Claude | *(blank in template)* | **Yes** |
| `TIER3_MODEL` | agent-service | Claude model ID | `claude-haiku-4-5-20251001` | No |
| `TIER3_QUOTA_PER_DAY` | agent-service | Maximum Tier 3 (Claude) calls per user per day | `50` | No |
| `MODEL_TIMEOUT_MS` | agent-service | Timeout in milliseconds for any model API call | `30000` | No |
| `FCM_SERVER_KEY` | intelligence-service | Firebase Cloud Messaging server key for push notifications. Leave blank to disable. | *(blank in template)* | **Yes** |

**Variables hardcoded in docker-compose.yml (not from .env):**

| Variable | Value | Reason |
|----------|-------|--------|
| `PORT` | 3000/3001/3002/3003/3005 per service | Fixed port per service, no need to configure |
| `REDIS_URL` | `redis://redis:6379` | Internal Docker DNS, never changes |
| `USER_SERVICE_URL` | `http://user-service:3001` | Internal DNS, set in gateway only |
| `JOBS_SERVICE_URL` | `http://jobs-service:3002` | Internal DNS, set in gateway only |
| `OPPORTUNITY_SERVICE_URL` | `http://opportunity-service:3003` | Internal DNS, set in gateway only |
| `AGENT_SERVICE_URL` | `http://agent-service:3005` | Internal DNS, set in gateway only |

**The DATABASE_URL construction:**

No single `DATABASE_URL` environment variable exists in `.env`. Instead, docker-compose.yml constructs it inline for each service:

```yaml
DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

With the template defaults, this expands to:
```
postgresql://gbmuser:yourpassword@postgres:5432/gbmjobhunter
```

**Generate JWT_SECRET:**

```bash
openssl rand -hex 64
```

This produces a 128-character hex string. Copy the entire output into the `JWT_SECRET=` line in `.env`.

---

## 7. The Local Dev Loop

### Root npm scripts

The root `package.json` is an npm workspace root. All scripts run from the repo root directory.

**`npm run backend`**

Starts all six backend services simultaneously on the host machine (no Docker). Uses `concurrently` to run them in one terminal with colour-coded output:

```
gateway    (cyan)   — npm run dev --workspace=@gbm/gateway
user       (green)  — npm run dev --workspace=@gbm/user-service
jobs       (yellow) — npm run dev --workspace=@gbm/jobs-service
opportunity(blue)   — npm run dev --workspace=@gbm/opportunity-service
intel      (magenta)— npm run dev --workspace=@gbm/intelligence-service
agent      (white)  — npm run dev --workspace=@gbm/agent-service
```

Each workspace's `dev` script uses `node --watch index.js` (the Node.js 18+ built-in file watcher). No nodemon required — Node.js restarts the process automatically when source files change. Faster restart than nodemon.

**Prerequisite:** Postgres and Redis must be running for the services to connect. Since `docker-compose.yml` is now the production compose file, you have two options for dev:
1. Run just the databases with docker: `docker compose up -d postgres redis`
2. Install Postgres and Redis locally

**Dev ports:** Services run on the same ports as production. In dev, `DATABASE_URL` in each service's local `.env` file should point to `localhost:5432` (or `localhost:5433` if you had a dev-specific port mapping in the original docker-compose).

**`npm run web`**

Starts the Vite development server for the React frontend:

```bash
npm run dev --workspace=@gbm/web
```

Serves on `http://localhost:5173`. Vite watches for file changes and hot-reloads the browser. In dev, `VITE_API_URL` is not set, so `client.js` uses its fallback `http://localhost:3000` — it hits the gateway running on the host.

**`npm run migrate`**

Runs `node scripts/migrate.js` from the repo root. Reads `DATABASE_URL` from `.env` in the repo root (or from `process.env` if already set). In development, point `DATABASE_URL` in the root `.env` to `localhost:5432` (or wherever Postgres is running).

**`npm run dev`**

Runs `docker-compose up -d`. **Note:** `docker-compose.yml` is now the production configuration. Running this on a developer machine starts the production stack (which requires the `.env` secrets to be filled). This script was originally intended for a dev docker-compose that has since been replaced. For local dev, use `npm run backend` and `npm run web` instead.

**`npm run setup:clickhouse`**

One-time setup script for ClickHouse (analytics data store). Not part of the regular deployment flow — only run this if you are enabling the ClickHouse analytics pipeline.

### Dev vs production port differences

| Component | Dev | Production |
|-----------|-----|-----------|
| Postgres (host port) | 5432 (or 5433 in a dev compose) | 127.0.0.1:5432 (host-only) |
| Redis (host port) | Exposed for debugging | Not exposed at all |
| Vite dev server | localhost:5173 | Not present (static files in /var/www/gbm/web/dist) |
| Gateway | localhost:3000 | 127.0.0.1:3000 (behind Caddy) |
| Services | localhost:3001–3005 | Internal Docker network only |
| HTTPS | None — plain HTTP | Caddy on 443 |
| VITE_API_URL | Not set → fallback http://localhost:3000 | /api (relative, set at build time) |

---

## 8. The Deploy Script

`scripts/deploy.sh` is designed to be run on every deploy — not just the first one. All steps are safe to repeat.

### Pre-execution setup

```bash
#!/bin/bash
set -e
```

`set -e` makes the script exit immediately if any command returns a non-zero exit code. A failed `git pull`, a failed `npm ci`, a failed `docker compose build` — any of these stops the script at that point. This prevents a half-deployed state where, for example, the frontend is rebuilt but migrations haven't run.

### Step 1: Load environment variables

```bash
APP_DIR="/var/www/gbm/app"
cd "$APP_DIR"

set -a
source .env
set +a
```

`set -a` makes all variables exported automatically. `source .env` reads the `.env` file and sets each line as a shell variable. `set +a` stops the auto-export. After this, `$POSTGRES_USER`, `$POSTGRES_PASSWORD`, etc. are available as shell variables throughout the rest of the script.

**What can go wrong:** `.env` doesn't exist, or a variable has a typo. The script will fail at the step that tries to use the missing variable. Fix: `cp .env.production .env` and fill in all blanks.

### Step 2: Pull latest code

```bash
git pull origin main
```

Fetches and merges the latest commits from the `main` branch.

**What can go wrong:**
- Git credentials not set up: `git pull` prompts for a username/password or SSH key that doesn't exist. Fix: configure SSH deploy keys or HTTPS credentials before running deploy.
- Merge conflict: the VPS has uncommitted local changes (e.g. someone edited Caddyfile in-place). Fix: never edit files directly on the VPS outside the repo. All changes go through git.
- Wrong branch: if `main` doesn't exist or the default branch is something else, the pull fails. Fix: run `git remote -v` and `git branch -a` to confirm branch names.

### Step 3: Build the frontend

```bash
cd web
npm ci
VITE_API_URL=/api npm run build
cd "$APP_DIR"
```

`npm ci` installs dependencies from `package-lock.json`. This is required on every deploy because a package version may have been updated in the pull.

`VITE_API_URL=/api npm run build` runs `vite build`. Vite reads `VITE_API_URL` from the environment and bakes the string `/api` into the built JS. The built output goes to `web/dist/`.

**What can go wrong:**
- `npm ci` fails: Node 20 must be installed on the host (`node --version`). The setup script installs it, but it must have run first.
- Build fails due to TypeScript or JSX errors: the code has a compile-time error. Fix: run `npm run build` locally first to catch these before deploy.
- Out of disk space: Vite writes compiled assets to `web/dist`. On a full disk, the build fails mid-write. Fix: `df -h` to check; `docker system prune` to recover space from unused Docker layers.

### Step 4: Copy static files to web root

```bash
rm -rf "$WEB_DIST"
cp -r web/dist/. "$WEB_DIST/"
```

`WEB_DIST="/var/www/gbm/web/dist"`. The old dist is deleted entirely first (`rm -rf`) to avoid stale asset files from a previous build lingering. Then the entire new build is copied.

**What can go wrong:**
- `/var/www/gbm/web/dist` doesn't exist: the setup script creates it, but if setup didn't run, this directory is missing. Fix: `mkdir -p /var/www/gbm/web/dist`.
- Permission error: the script runs as root (as installed by setup-vps.sh). If it somehow runs as a non-root user without write access to `/var/www/gbm/`, it will fail. Fix: run deploy as root or with sudo.
- The site shows a blank page between `rm -rf` and `cp -r` completing: this window is very brief (sub-second) but it exists. Caddy serves the directory — if it's empty, it serves a 404. On a live site this is acceptable; for zero-downtime deployments you'd need a more sophisticated strategy.

### Step 5: Update Caddy config

```bash
cp Caddyfile /etc/caddy/Caddyfile
```

Overwrites Caddy's live config with the one from the repo. The `Caddyfile` must have the real domain name (not `your-domain.com`) before this runs.

**What can go wrong:**
- `Caddyfile` still contains `your-domain.com`: Caddy will reload and try to get a TLS certificate for that literal hostname, which will fail. The reload happens later (`systemctl reload caddy`). Caddy will log an error and continue serving with the old config.
- First deploy: Caddyfile is copied but Caddy hasn't reloaded yet. The old config (possibly the default Caddy placeholder config) is still active until the reload at the end of the script.

### Step 6: Rebuild and restart Docker services

```bash
docker compose build --pull
docker compose up -d
```

`docker compose build --pull` rebuilds all service images. The `--pull` flag pulls the latest versions of base images (`node:20-alpine`, `postgres:15-alpine`, `redis:7-alpine`) before building. This picks up security patches to base images.

`docker compose up -d` starts all services in the background. If a service's image changed (because the build updated it), the old container is stopped and replaced. Services whose image didn't change are left running — this is the incremental update: only changed services restart.

**What can go wrong:**
- `.dockerignore` missing: the build succeeds but native modules are broken (see Section 3). Symptom: services start but crash with ELF header errors. Fix: create the `.dockerignore` files and rebuild.
- Out of memory during build: Alpine builds are small, but running six builds simultaneously on a CX22 (4 GB RAM) can be tight. If a build is killed by the OOM killer, `docker compose build` exits with a non-zero code and `set -e` stops the script. Fix: rebuild one at a time or upgrade to a larger instance.
- Port already in use: if something else on the host is listening on port 3000, `docker compose up` fails. Port 3000 and 5432 should only have Docker containers using them.

### Step 7: Wait for Postgres

```bash
until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; do
  sleep 1
done
```

Polls Postgres every second until it accepts connections. The `-T` flag disables pseudo-TTY allocation (required in non-interactive scripts). The `2>/dev/null` suppresses error output from failed attempts.

This loop is necessary because `docker compose up -d` returns immediately after starting the containers — the postgres container may still be initialising when the script reaches the migration step.

**What can go wrong:**
- Loop runs forever: Postgres never becomes healthy. Check `docker compose logs postgres` for initialisation errors (wrong password, insufficient disk space, corrupt data volume). The health check in docker-compose.yml will also be failing, causing dependent services to wait.

### Step 8: Run migrations

```bash
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}" \
  node scripts/migrate.js
```

Runs on the **host** machine using the host's Node.js, connecting to Postgres via `localhost:5432` (the host port that the postgres container binds to `127.0.0.1:5432:5432`).

The `DATABASE_URL` is set inline as a prefixed environment variable — it overrides any `DATABASE_URL` that might already be set in the environment.

All migrations are idempotent — already-applied migrations are skipped (see Section 9). Safe to run on every deploy.

**What can go wrong:**
- `node` is not found: setup-vps.sh installs Node 20, but if setup didn't run, it's missing. Fix: `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`.
- `pg` package not found: `scripts/migrate.js` uses `require('pg')`. The root `package.json` has `pg` as a devDependency. If `npm install` hasn't been run at the repo root, `pg` won't be installed. Fix: `npm install` in `/var/www/gbm/app` before first deploy.
- Migration fails: a SQL error in one of the migration files. The script rolls back the failed migration and exits with code 1. `set -e` stops the deploy. Fix the SQL file, commit, and re-run deploy. The failed migration will be retried.

### Step 9: Reload Caddy

```bash
systemctl reload caddy
```

Sends a reload signal to the Caddy systemd service. Caddy reads the updated `/etc/caddy/Caddyfile` and applies it without dropping existing connections. If the config has a syntax error, Caddy logs the error and keeps the old config running — it does not crash.

**What can go wrong:**
- Caddyfile has a syntax error: `caddy validate --config /etc/caddy/Caddyfile` before reloading to check. Syntax errors prevent the new config from loading.
- Domain still says `your-domain.com` in Caddyfile: Caddy attempts to provision a TLS cert for `your-domain.com`, which fails. The site may serve on HTTP only or show a certificate warning.

---

## 9. Running Migrations

### How migrate.js works

`scripts/migrate.js` is a standalone Node.js script. It does not use any ORM or migration framework — plain SQL and `node-postgres`.

**Step 1: Create the tracking table**

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id         SERIAL PRIMARY KEY,
  filename   VARCHAR NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
)
```

This runs every time the script is called. `IF NOT EXISTS` makes it idempotent. The table tracks which migration files have been applied.

**Step 2: Find migration files**

```js
fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()
```

Reads all `.sql` files from the `migrations/` directory and sorts them alphabetically. Because migration files are named with a numeric prefix (`001_create_users.sql`, `002_create_jobs.sql`, etc.), alphabetical sort is the same as numeric order. This is the order they are applied.

**Step 3: For each file, check and apply**

```js
const { rowCount } = await client.query(
  'SELECT 1 FROM migrations WHERE filename = $1', [file]
);

if (rowCount > 0) {
  console.log(`  skip  ${file}`);
  continue;
}
```

If the filename is already in the `migrations` table, the file is skipped. This is the idempotency mechanism.

If the file has not been applied:

```js
await client.query('BEGIN');
await client.query(sql);
await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
await client.query('COMMIT');
console.log(`  apply ${file}`);
```

Each migration runs in its own transaction. `BEGIN` starts it. The SQL from the file runs. If it succeeds, the filename is recorded in `migrations`. `COMMIT` finalises both the migration SQL and the tracking row atomically.

### What the output looks like

On a fresh database:

```
  apply 001_extensions.sql
  apply 002_users.sql
  apply 003_jobs.sql
  apply 004_applications.sql
  apply 005_application_events.sql
  apply 006_companies.sql
  apply 007_cohort_patterns.sql
  apply 008_indexes.sql
  apply 009_user_insights.sql
  apply 010_user_insights_source.sql
  apply 011_resume_json.sql
  apply 012_ats_score_cache.sql
Migrations complete.
```

On subsequent runs when nothing is new:

```
  skip  001_extensions.sql
  skip  002_users.sql
  ...
  skip  012_ats_score_cache.sql
Migrations complete.
```

### How to run a single new migration

Create a new file in `migrations/` with the next sequential number:

```sql
-- migrations/013_add_new_column.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';
```

Then run:

```bash
DATABASE_URL="postgresql://gbmuser:yourpassword@localhost:5432/gbmjobhunter" node scripts/migrate.js
```

The script skips 001–012 (already in the `migrations` table) and applies 013. On the VPS, the deploy script does this automatically.

### What happens if a migration fails halfway

If `client.query(sql)` throws an error (syntax error, constraint violation, etc.):

```js
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Migration failed:', err.message);
  process.exit(1);
}
```

`ROLLBACK` undoes everything back to the `BEGIN`. Neither the migration's SQL changes nor the `INSERT INTO migrations` row are committed. The database is left in exactly the state it was in before the failed migration.

The next run of `migrate.js` will find that the file is still not in the `migrations` table and attempt it again. You must fix the SQL in the migration file before re-running — do not create a compensating migration to fix the failed one, because the failed one hasn't been applied at all.

**Important:** Do not modify migration files that have already been applied. The `migrations` table records only the filename. If you edit an applied file's content, the script still sees the filename as applied and skips it — your changes are never run. Write a new migration file instead.

### Running migrations in dev

```bash
npm run migrate
```

From the repo root. This reads `DATABASE_URL` from the root `.env` file via `require('dotenv').config()` at the top of `migrate.js`. In dev, set `DATABASE_URL` in the root `.env` to point to your local or Docker Postgres instance.

---

## 10. The First Deployment Checklist

Every single step required before the system works. In order. Do not skip steps.

---

### Phase 1: DNS and domain

**1. Buy a domain** if you don't have one. Set up an A record:

```
Type:  A
Name:  @ (or your-domain.com)
Value: <VPS IP address>
TTL:   300 (5 minutes is fine)
```

**2. Check DNS propagation before proceeding past step 13:**

```bash
dig +short your-domain.com A
```

Must return the VPS IP. DNS can take anywhere from 1 minute to 48 hours. TTL of 300 means most resolvers pick it up within 5–10 minutes.

---

### Phase 2: VPS setup

**3. Create a Hetzner CX22** (or equivalent): Ubuntu 22.04 LTS, 2 vCPU, 4 GB RAM. Note the public IP address.

**4. SSH into the VPS as root:**

```bash
ssh root@<VPS IP>
```

**5. Upload or clone the repo.** Two options:

Option A — SSH deploy key (recommended):
```bash
# Generate a key pair
ssh-keygen -t ed25519 -f /root/.ssh/deploy_key -N ""
cat /root/.ssh/deploy_key.pub
# Add the public key to your GitHub repo under Settings → Deploy Keys
# Then configure SSH:
cat >> /root/.ssh/config << 'EOF'
Host github.com
  IdentityFile /root/.ssh/deploy_key
EOF
git clone git@github.com:yourname/gbmjobhunter.git /var/www/gbm/app
```

Option B — HTTPS with a personal access token (simpler for a one-server setup):
```bash
git clone https://<token>@github.com/yourname/gbmjobhunter.git /var/www/gbm/app
```

**6. Run the VPS setup script:**

```bash
bash /var/www/gbm/app/scripts/setup-vps.sh
```

This installs Docker, Caddy, Node.js 20, UFW, and creates the web root directory. Takes 2–5 minutes. If it succeeds, the last line printed is `=== Setup complete ===`.

**7. Verify Docker is running:**

```bash
docker --version
docker compose version
```

Both should return version numbers without errors.

---

### Phase 3: Configuration

**8. Navigate to the app directory:**

```bash
cd /var/www/gbm/app
```

All remaining commands run from here unless specified.

**9. Copy the environment template:**

```bash
cp .env.production .env
```

**10. Fill in every blank secret in `.env`:**

Open `.env` with a text editor:

```bash
nano .env
```

Fill in these values:

```
POSTGRES_PASSWORD=<a strong random password, e.g. openssl rand -hex 32>
JWT_SECRET=<run: openssl rand -hex 64  — copy the full output>
ALLOWED_ORIGINS=https://your-domain.com
TIER2_API_KEY=<your Groq API key from console.groq.com>
TIER3_API_KEY=<your Anthropic API key from console.anthropic.com>
FCM_SERVER_KEY=<your Firebase server key, or leave blank>
```

The non-secret values are already filled in the template:
```
POSTGRES_DB=gbmjobhunter
POSTGRES_USER=gbmuser
NODE_ENV=production
TIER2_API_BASE=https://api.groq.com/openai/v1
TIER2_MODEL_NAME=llama-3.3-70b-versatile
TIER3_MODEL=claude-haiku-4-5-20251001
TIER3_QUOTA_PER_DAY=50
MODEL_TIMEOUT_MS=30000
```

Save and close (`Ctrl+X` in nano, `Y` to confirm).

**11. Edit the Caddyfile — replace the placeholder domain:**

```bash
nano Caddyfile
```

Change line 4:
```
your-domain.com {
```
to:
```
your-domain.com {
```
(replace `your-domain.com` with your actual domain, e.g. `gbmjobs.io`)

Save and close.

---

### Phase 4: Pre-build requirements

**12. Create `.dockerignore` in all six service directories:**

```bash
for dir in gateway services/user services/jobs services/opportunity services/agent services/intelligence; do
  echo "node_modules" > "$dir/.dockerignore"
done
```

Verify:

```bash
cat gateway/.dockerignore
# Should print: node_modules
```

**13. Install Node.js dependencies for the migration runner:**

`migrate.js` uses the `pg` and `dotenv` packages. They are listed in the root `devDependencies`. Install them:

```bash
npm install
```

This installs at the monorepo root only — it does not install inside each service (that's what Docker does). You only need `pg` and `dotenv` on the host for migrations.

---

### Phase 5: Wait for DNS

**14. Confirm DNS has propagated:**

```bash
dig +short your-domain.com A
```

Must return the VPS IP. If it returns nothing or a different IP, wait and retry. Do not proceed until DNS is correct — Caddy cannot get a TLS certificate without it.

---

### Phase 6: First deploy

**15. Run the deploy script:**

```bash
bash scripts/deploy.sh
```

Watch the output. It prints `[1/6]`, `[2/6]`, etc. The full run takes 5–10 minutes on a fresh VPS (Docker pulls base images, npm installs, Vite builds). Subsequent deploys are faster (Docker layer cache).

**What the output looks like on success:**

```
=== [1/6] Pull latest code ===
Already up to date.

=== [2/6] Build frontend ===
...
✓ 1234 modules transformed.
dist/index.html                  1.20 kB
dist/assets/index-abc123.js    512.34 kB

=== [3/6] Copy static build to web root ===

=== [4/6] Update Caddy config ===

=== [5/6] Rebuild and restart services ===
...
[+] Building 6/6  (all services built)
[+] Running 8/8  (all containers started)

Waiting for Postgres to be ready...

=== [6/6] Run migrations ===
  apply 001_extensions.sql
  apply 002_users.sql
  ...
  apply 012_ats_score_cache.sql
Migrations complete.

=== Reload Caddy ===

=== Deploy complete ===
```

---

### Phase 7: Verification

**16. Check all containers are running:**

```bash
docker compose ps
```

All services should show `Up` or `Up (healthy)`. If any show `Restarting`, read the logs:

```bash
docker compose logs <service-name>
```

**17. Test HTTPS:**

```bash
curl -I https://your-domain.com
```

Should return `HTTP/2 200`. If you see a certificate error, Caddy may still be provisioning the certificate — wait 30 seconds and retry. If it times out, check that port 443 is open in UFW (`ufw status`).

**18. Test the API through Caddy:**

```bash
curl https://your-domain.com/api/health
```

The gateway has a `/health` route. Should return something like `{ "status": "ok" }`.

**19. Test user registration:**

Open your domain in a browser, navigate to `/register`, and create an account. Confirm the account is created, you are logged in, and the dashboard loads.

---

### Common first-deploy mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| `.dockerignore` missing | user-service crashes with `invalid ELF header` | Create `.dockerignore` files, rebuild |
| `JWT_SECRET` left blank | All auth routes return 401 or crash | Fill in JWT_SECRET in `.env`, `docker compose up -d` |
| `ALLOWED_ORIGINS` wrong | Browser gets CORS errors on login | Set to exact origin including `https://` |
| DNS not propagated before deploy | Caddy gets no TLS cert, site is HTTP | Wait for DNS, `systemctl reload caddy` |
| Domain not updated in Caddyfile | Caddy tries to cert `your-domain.com` | Edit Caddyfile, `cp Caddyfile /etc/caddy/Caddyfile`, reload |
| `npm install` not run | `Cannot find module 'pg'` when migrations run | `npm install` in `/var/www/gbm/app` |
| `node_modules` in Docker context | Services crash with native module errors | Create `.dockerignore` files |
| `POSTGRES_PASSWORD` blank | Postgres starts but services can't auth | Set password in `.env`, `docker compose down -v`, `docker compose up` |
