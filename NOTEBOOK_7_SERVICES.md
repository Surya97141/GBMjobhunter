# Notebook 7 — Services, Pages, Mobile, and Tests

This notebook covers everything not addressed in Notebooks 1–6: the gateway's internal implementation, the user/jobs/opportunity service layers in full, the shared package, what each web page fetches and renders, the mobile app screens, and the test suite.

---

## 1. Gateway Internals

### Startup validation

`gateway/index.js` validates five required environment variables before the server starts:

```
JWT_SECRET, USER_SERVICE_URL, JOBS_SERVICE_URL, OPPORTUNITY_SERVICE_URL, REDIS_URL
```

If any are absent, the process throws and exits immediately. `AGENT_SERVICE_URL` and `OPPORTUNITY_SERVICE_URL` are also required — the full list is in the index.js startup check. This makes misconfiguration loud: the container crashes on startup rather than routing to undefined URLs.

### Middleware stack (in order)

Every request passes through these middleware before hitting any route handler:

1. **`helmet()`** — sets security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, and others. The Content-Security-Policy is disabled (`contentSecurityPolicy: false`) because the gateway only serves JSON — CSP is a browser concern.

2. **`cors()`** — custom origin validator. A request is allowed if it meets any of these three conditions (evaluated in order):
   - No `Origin` header at all (curl, Postman, server-to-server calls)
   - Origin starts with `chrome-extension://` (the GBM Chrome extension)
   - Origin is in the `ALLOWED_ORIGINS` env var (comma-separated, trimmed, `https://your-domain.com`)
   If none match, the request is rejected with a 403 CORS error before it reaches any route.

3. **`express.json({ limit: '100kb' })`** — parses JSON request bodies. The 100 kb limit prevents request-body DoS attacks. Requests with a larger body get a 413 before any route code runs.

### Authentication middleware

Two variants, both in `gateway/src/middleware/auth.middleware.js`:

**`requireAuth(req, res, next)`** — used on all protected routes:
1. Reads the `Authorization` header. Expected format: `Bearer <jwt>`.
2. If missing or not starting with `Bearer `, returns 401.
3. Calls `jwt.verify(token, JWT_SECRET)`. If the token is expired or signature is invalid, returns 401.
4. Sets `req.user = { sub: userId, email }` from the decoded payload.
5. Sets two headers on the request before forwarding: `x-user-id: <userId>` and `x-user-email: <email>`. These are how downstream services receive the authenticated user's identity — services never verify JWTs themselves, they read these injected headers.
6. Calls `next()`.

**`optionalAuth(req, res, next)`** — used on routes where auth improves the response but isn't required:
- Same logic, but if the token is missing or invalid, it calls `next()` anyway instead of returning 401. `req.user` will be `undefined` for unauthenticated requests.

### Rate limiting middleware

`gateway/src/middleware/rateLimiter.middleware.js` exports two limiters, both using Redis as the backing store (`rate-limit-redis` package with `ioredis`):

**`standardLimiter`** — applied to most routes:
- 100 requests per 60-second window per key
- Key: `rl:standard:${req.user?.sub || req.ip}` — keyed by user ID if authenticated, by IP if not
- Returns 429 with a JSON body on breach (not the default text/plain)

**`resumeUploadLimiter`** — applied only to `POST /users/me/resume`:
- 10 requests per 60-second window per key
- Key: `rl:resume:${req.user?.sub || req.ip}`
- Resume parsing is CPU-intensive (pdf-parse) — this prevents repeated upload abuse

### Proxy mechanism: two modes

`gateway/src/routes/proxy.routes.js` implements two forwarding functions with different semantics.

**`forward(baseUrl)`** — for all standard JSON routes:

```js
async function forward(baseUrl) {
  return async (req, res) => {
    const url = baseUrl + req.path;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];

    const response = await axios({
      method:  req.method,
      url,
      headers,
      data:    req.body,
      params:  req.query,
      validateStatus: () => true,  // never throw on HTTP errors
    });

    res.status(response.status).json(response.data);
  };
}
```

Key design decisions:
- `validateStatus: () => true` — axios never throws for any HTTP status code. A 404 or 500 from a downstream service is forwarded to the browser as-is. The gateway is transparent.
- `host` and `content-length` headers are deleted before forwarding. `host` would confuse the target service (it would see the gateway's host, not its own). `content-length` is recalculated by axios based on the serialised body.
- Query parameters (`req.query`) are passed through untouched.
- The downstream service's response body is forwarded with `res.json(response.data)` — it re-serialises the already-parsed JSON. This is slightly inefficient but guarantees the response is valid JSON.

**`streamForward(baseUrl)`** — used exclusively for `POST /users/me/resume` (multipart/form-data):

```js
async function streamForward(baseUrl) {
  return (req, res) => {
    const options = {
      method: 'POST',
      headers: { ...req.headers, host: new URL(baseUrl).host },
    };
    const proxyReq = http.request(baseUrl + req.path, options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        try {
          res.status(proxyRes.statusCode).json(JSON.parse(body));
        } catch {
          res.status(proxyRes.statusCode).send(body);
        }
      });
    });
    req.pipe(proxyReq);
  };
}
```

Multipart/form-data cannot go through `express.json()` — it's binary, not JSON. The gateway must pipe the raw request stream directly to the user-service without parsing it. `http.request` with `req.pipe(proxyReq)` accomplishes this. The response is collected as a string and parsed as JSON (or passed through as plain text if JSON parsing fails).

This is why `POST /users/me/resume` must be registered **before** `router.use('/users', ...)` in the routing table — if it weren't, the request would hit the JSON `express.json()` body parser first, which would try to parse multipart data as JSON and destroy the stream.

### Full gateway routing table

```
GET  /health
     → { status: 'ok', timestamp: ISO }
     No auth. No rate limiting.

POST /auth/*
     → forward(USER_SERVICE_URL)
     No auth (unauthenticated users register/login here).
     standardLimiter applied.

POST /users/me/resume
     → streamForward(USER_SERVICE_URL)
     requireAuth + resumeUploadLimiter.
     Registered BEFORE /users/* to avoid body-parser interception.

GET  /users/*
PUT  /users/*
     → forward(USER_SERVICE_URL)
     requireAuth + standardLimiter.

GET  /applications/*
POST /applications
     → forward(JOBS_SERVICE_URL)
     requireAuth + standardLimiter.

PUT  /applications/:id/outcome
     → forward(JOBS_SERVICE_URL)
     requireAuth + standardLimiter.

GET  /jobs/*
     → forward(JOBS_SERVICE_URL)
     requireAuth + standardLimiter.

GET  /opportunities/*
     → forward(OPPORTUNITY_SERVICE_URL)
     requireAuth + standardLimiter.

GET  /agent/*
POST /agent/*
     → forward(AGENT_SERVICE_URL)
     requireAuth + standardLimiter.
     x-user-id header injected by requireAuth is how agent-service knows which user is calling.
```

---

## 2. User Service

### Startup

`services/user/index.js` validates required env vars: `DATABASE_URL`, `JWT_SECRET`. Creates an Express app, mounts two route groups (`/auth`, `/users`), and starts on `PORT` (default 3001).

The service has its own lightweight auth middleware that reads the `x-user-id` header injected by the gateway. It does not verify JWTs — trust is established by the gateway. Any request that reaches user-service already has a verified identity in `x-user-id`.

### Auth routes (`/auth`)

**`POST /auth/register`**

Request body: `{ email, password }`. Validation:
- Email: valid format (regex)
- Password: minimum 8 characters

Controller calls `authService.register(email, password)`:
1. `SELECT id FROM users WHERE email = $1` — if row exists, throws 409 Conflict ("Email already registered").
2. `bcrypt.hash(password, 12)` — bcrypt with 12 salt rounds. 12 is deliberate: slow enough to resist brute-force, fast enough that legitimate logins don't noticeably lag on a CX22.
3. `INSERT INTO users (email, hashed_password) VALUES ($1, $2) RETURNING *`
4. `issueToken({ sub: user.id, email: user.email })` — signs a JWT with `JWT_SECRET`, `{ sub, email }` payload, 24-hour expiry.
5. Returns 201 with `{ user: { id, email, created_at }, token }`.

**`POST /auth/login`**

Request body: `{ email, password }`. Validation:
- Email and password both required (min length 1)

Controller calls `authService.login(email, password)`:
1. `SELECT * FROM users WHERE email = $1` — if not found, returns 401. The error message is identical for wrong password and non-existent email ("Invalid credentials") to prevent user enumeration.
2. `bcrypt.compare(password, user.hashed_password)` — if false, returns 401.
3. Strips `hashed_password` from the user object before including it in the response.
4. Issues and returns a new JWT.
5. Returns 200 with `{ user: { id, email, ... }, token }`.

The returned token is what the browser stores in `localStorage` as `gbm_token`.

### User routes (`/users`)

All routes require `x-user-id` header (set by gateway's `requireAuth`). The service reads this to scope queries to the authenticated user.

**`GET /users/me`**

Returns the full user profile row. Called on every page load to verify the session and hydrate the UI with user data.

**`PUT /users/me`**

Request body: any subset of `{ name, email, target_role, target_location, years_of_experience, cover_letter_template }`.

`usersDb.updateUserProfile` uses an explicit allowlist to construct the UPDATE:

```js
const ALLOWED = ['name', 'email', 'target_role', 'target_location', 'years_of_experience', 'cover_letter_template'];
```

Only keys present in both the request body AND this allowlist are included in the SQL `SET` clause. Any attempt to pass `hashed_password`, `id`, `created_at`, or any other column is silently ignored. This prevents column injection attacks.

**`POST /users/me/resume`**

The most complex endpoint in the service. The request arrives as multipart/form-data (piped by the gateway's `streamForward`).

Upload middleware (`upload.middleware.js`):
- `multer({ storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })` — 5 MB limit, stores in memory (not disk).
- Accepts only `mimetype === 'application/pdf'`. Non-PDF files get a 400 before the controller runs.
- Custom error handler returns JSON (not multer's default HTML) so the frontend can parse the error.

Controller (`uploadResume`):
1. `pdf-parse` extracts raw text from `req.file.buffer`.
2. `resumeParser.parseResumeText(rawText)` extracts structured data (skills, work experience, education). See Section 9.
3. `resumeQualityScore(parsed)` computes a 0–100 completeness score.
4. `userService.saveResumeAndScore(userId, resumeJson, qualityScore)` saves to `users.resume_json` and `users.ats_score_cache`.
5. Returns `{ user, resumeJson, atsScore }`.

**`GET /users/me/resume`**

Returns the `resume_json` column from the users table. Returns `{ resume: null }` if no resume has been uploaded — the frontend uses this to show an upload prompt.

**`GET /users/me/insights`**

Calls `insightsDb.getInsightsByUserId(userId)`. Returns all `user_insights` rows for this user, ordered by `created_at DESC`. Each insight has `id`, `headline`, `action`, `source`, `seen`, `created_at`.

**`PUT /users/me/insights/:id/seen`**

Marks a single insight as read. Updates `user_insights.seen = true WHERE id = $1 AND user_id = $2`. The `AND user_id` check ensures users can only mark their own insights.

---

## 3. Jobs Service

### Startup

`services/jobs/index.js` validates: `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`. Creates two route groups: `/applications` and `/jobs`. Starts on `PORT` (default 3002).

### Applications routes (`/applications`)

**`POST /applications`** — log a new job application

Request body: `{ companyName, roleTitle, jdText?, pageUrl? }`.
- `companyName` and `roleTitle` are required.
- `jdText` defaults to `''` if omitted.
- `pageUrl` defaults to `''` if omitted.

`applicationsService.logApplication(userId, { companyName, roleTitle, jdText, pageUrl })`:
1. Fetches the user's resume JSON (`usersDb.getResume(userId)`).
2. If resume exists and jdText is non-empty, runs `scoreResumeAgainstJD(resumeJson, jdText)` → `atsScore` (0–100). Otherwise `atsScore = null`.
3. `fingerprintJD(jdText, pageUrl)` → `{ hash, seniority, atsPlatform }`. Even for empty jdText, a fingerprint hash is computed (it will hash an empty string, which is valid but won't match other applications).
4. Finds or creates a company row: `SELECT id FROM companies WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`. If not found, `INSERT INTO companies (name) VALUES ($1) RETURNING id`.
5. `INSERT INTO applications (user_id, company_id, role_title, jd_fingerprint_hash, ats_score_at_apply, ...) VALUES (...)`.
6. Publishes `application.logged` to BullMQ queue.
7. Returns `{ application, atsScore, seniority }`.

Returns 201 on success.

**`GET /applications`**

Query params: `limit` (1–100, default no limit), `offset` (default 0).

Returns all applications for the user, ordered by `applied_at DESC`. Each row includes `id`, `company_name` (joined from companies), `role_title`, `outcome`, `ats_score_at_apply`, `applied_at`.

**`GET /applications/stats`**

Returns four counters for the authenticated user:
```json
{
  "total":      42,
  "interviews":  8,
  "ghosted":    12,
  "offers":      1
}
```

Single SQL query using COUNT FILTER:
```sql
SELECT
  COUNT(*)                                              AS total,
  COUNT(*) FILTER (WHERE outcome = 'interview')         AS interviews,
  COUNT(*) FILTER (WHERE outcome = 'ghosted')           AS ghosted,
  COUNT(*) FILTER (WHERE outcome = 'offer')             AS offers
FROM applications
WHERE user_id = $1
```

**`PUT /applications/:id/outcome`**

Request body: `{ outcome, responseDays? }`.

`outcome` must be one of: `pending`, `ghosted`, `rejected`, `interview`, `offer`. The service validates against this enum before updating.

`responseDays` is optional (nullable). Represents how many days it took to get a response. Used in cohort pattern computation.

1. `UPDATE applications SET outcome = $1, response_days = $2 WHERE id = $3 AND user_id = $4` — the `AND user_id` prevents users from updating other users' applications.
2. If `rowCount === 0`, returns 404.
3. Publishes `outcome.updated` to BullMQ queue.
4. Returns the updated application row.

**`POST /applications/score`**

Request body: `{ jdText }`. Minimum 10 characters for jdText.

This is the real-time ATS scoring endpoint — called by the Chrome extension when detecting a job page, and by the ProfilePage when previewing a score.

1. Fetches user's resume JSON (`usersDb.getResume(userId)`).
2. If no resume: returns `{ score: null, reason: 'no_resume' }`.
3. If resume: `scoreResumeAgainstJD(resumeJson, jdText)` → score (0–100).
4. Returns `{ score }`.

### Jobs routes (`/jobs`)

**`GET /jobs/ghost-score`**

Query params: `jdFingerprintHash` (required), `companyId?`, `companyName?`.

`ghostScore.service.computeGhostScore(hash, { companyId, companyName })`:

1. **Cohort query** (for this exact JD fingerprint):
   ```sql
   SELECT COUNT(*) AS cohort_size,
          COUNT(*) FILTER (WHERE outcome = 'ghosted') AS ghosted_count,
          MIN(applied_at) AS first_seen,
          MIN(role_title) AS role_title
   FROM applications
   WHERE jd_fingerprint_hash = $1
   ```

2. If `cohort_size < 3` (`MIN_COHORT` constant), return `{ score: null, label: 'insufficient_data', cohortSize, reasons: [...] }`.

3. **Repost count query** (parallel with company query):
   ```sql
   SELECT COUNT(DISTINCT jd_fingerprint_hash) AS repost_count
   FROM applications
   WHERE company_id = $1
     AND LOWER(TRIM(role_title)) = LOWER(TRIM($2))
     AND applied_at > NOW() - INTERVAL '90 days'
   ```
   Counts how many distinct JD fingerprints exist for the same company + role in 90 days. More than 1 means the job has been reposted with slightly different JD text — a ghost signal.

4. **Company ghost rate query** (parallel with repost query):
   ```sql
   SELECT ghost_rate FROM companies WHERE id = $1
   ```
   The `ghost_rate` column (a float 0–1) is computed externally. May be null if the company is new.

5. **Score formula:**
   ```
   score = (ghostedFraction × 50)
         + (min(daysLive / 90, 1) × 25)
         + (min(repostCount / 3, 1) × 15)
         + (companyGhostRate × 10)
   ```

6. **Label thresholds:** `score >= 65` → `high_risk`, `score >= 35` → `moderate_risk`, otherwise `low_risk`.

7. **Reasons array** — each contributing signal generates a human-readable reason string only if it met its threshold:
   - `ghostedFraction > 0.5` → e.g. "62% of applicants to this posting received no response"
   - `daysLive > 45` → e.g. "Posting has been live for 73 days"
   - `repostCount > 1` → e.g. "Same role has been reposted 3 times in 90 days"
   - `companyGhostRate > 0.4` → e.g. "Company ghosts 48% of applicants historically"

**`GET /jobs/demand-supply`**

Query params: `skill?`, `region?`.

If both provided: returns time-series demand history for that skill in that region.
If either is missing: returns the latest aggregate skill demand snapshot across all regions.

Used by the Insights page to render the geographic distribution globe.

### Queue producers

`services/jobs/src/producers/producer.js` wraps BullMQ. Two functions:

```js
publishApplicationLogged({ userId, applicationId, jdFingerprintHash, roleBucket, atsPlatform })
publishOutcomeUpdated({ userId, applicationId, outcome, responseDays })
```

Both publish to queues with:
- `attempts: 3`
- `backoff: { type: 'exponential', delay: 1000 }` — 1s, 2s, 4s between retries
- `removeOnComplete: { count: 100 }` — keeps last 100 completed jobs for debugging

Queue names come from the shared constants: `'application.logged'` and `'outcome.updated'`.

---

## 4. Opportunity Service

### What it does

The opportunity service is a recommendation engine with no database writes. It reads from two sources:
1. Static data files embedded in the service (`skillPaths.js`, `courses.js`, `communities.js`)
2. Live cohort data from Postgres (`skill_impact` table, populated by the intelligence pipeline)

It answers two questions: "What should I learn next?" and "Where should I connect with other developers?"

### Routes (`/opportunities`)

**`GET /opportunities`**

Query params: `skills` (comma-separated), `interests` (comma-separated).

Both are optional. If the user hasn't uploaded a resume, the frontend calls this endpoint without skill data and gets a general recommendation.

`opportunitiesService.buildRecommendations(currentSkills, interests)`:

1. Fetches live skill impact scores from Postgres: `SELECT skill_name, skill_success_rate, baseline_success_rate, lift_score, sample_size FROM skill_impact WHERE sample_size >= 15`.
2. Iterates the full skill graph (`skillPaths.js` — 90+ skills).
3. Filters to skills the user doesn't already have (not in `currentSkills`).
4. For each candidate skill, scores it:
   - **Prerequisite gate:** All prerequisites must be in `currentSkills` or `interests`. If a skill requires `['javascript', 'node.js']` and the user doesn't have both, the skill is excluded entirely.
   - **Interest score:** If the skill name contains any interest keyword, +10 points.
   - **Cohort lift score:** If real data exists (sample_size ≥ 15), `liftScore × 20` points (the `REAL_DATA_WEIGHT=20` multiplier). This is the heaviest signal.
   - **Level bonus:** foundational +3, intermediate +2, advanced +1 — gently biases toward foundational skills when everything else is equal.
5. Sorts by score descending, returns top 10.
6. Each recommendation includes:
   - `skill`, `level`, `domain`
   - `score` (internal ranking score, used for ordering)
   - `courses` (3 courses per skill from `courses.js`, mix of free + paid platforms)
   - `dataSource`: `'cohort'` if real lift data was used, `'heuristic'` if only the static graph was used
   - `reason`: if `dataSource === 'cohort'`, a human-readable string like "Adding this skill increases offer rate by 23% based on 47 similar applicants"

**`GET /opportunities/communities`**

Query params: `skills` (comma-separated), `interests` (comma-separated).

`communitiesService.findMatchingCommunities(skills, interests)`:
1. For each community in `communities.js`, counts how many of the community's `tags` appear in the user's skills or interests.
2. Filters to communities with at least one match.
3. Sorts by match count descending.
4. Returns all matching communities (not capped).

### The skill graph (`skillPaths.js`)

A static JavaScript object defining 90+ skills and their relationships. Each skill entry:

```js
'react': {
  prerequisites: ['javascript', 'html', 'css'],
  next:          ['next.js', 'react-native'],
  level:         'intermediate',
  domain:        'frontend',
}
```

- `prerequisites` — skills the user must already have. Checked with AND logic — all must be present.
- `next` — skills this one unlocks. Used for path planning (future feature).
- `level` — `'foundational'`, `'intermediate'`, or `'advanced'`. Used for ordering ties.
- `domain` — `'frontend'`, `'backend'`, `'devops'`, `'data'`, `'mobile'`, etc.

The graph covers major paths like:
```
javascript → node.js → express → nest.js
javascript → react → next.js
sql → postgresql → clickhouse
git → github-actions
python → django / fastapi / flask
docker → kubernetes
```

### The courses data (`courses.js`)

Maps 45+ skill names to exactly 3 courses each. Course object shape:
```js
{ title, platform, url, free: boolean }
```

Platforms include: freeCodeCamp (free), Udemy (paid), Coursera (paid/audit), LinkedIn Learning (paid), official documentation, YouTube channels.

### The communities data (`communities.js`)

10 communities, each:
```js
{
  name:        'Reactiflux',
  platform:    'Discord',
  description: '...',
  tags:        ['react', 'javascript', 'frontend', 'next.js'],
  joinUrl:     'https://discord.gg/reactiflux',
}
```

Seven Discord servers (Reactiflux, Nodeiflux, Python Discord, DevOps, Programmer's Hangout, Machine Learning, TypeScript Community), two Slack workspaces (Postgres, Kubernetes), one forum (DEV Community).

---

## 5. The Shared Package

`shared/` is an npm workspace (`@gbm/shared`) containing two files consumed by multiple services.

### `shared/constants/index.js`

```js
const QUEUE_NAMES = {
  APPLICATION_LOGGED: 'application.logged',
  OUTCOME_UPDATED:    'outcome.updated',
  PATTERN_COMPUTED:   'pattern.computed',
};

const OUTCOME_STATUSES = ['pending', 'ghosted', 'rejected', 'interview', 'offer'];

const RATE_LIMITS = {
  STANDARD:      { points: 100, duration: 60 },
  RESUME_UPLOAD: { points: 10,  duration: 60 },
};
```

`QUEUE_NAMES` is the source of truth for queue name strings. Changing a queue name here changes it everywhere — producers in jobs-service and consumers in intelligence-service both import from this file.

`OUTCOME_STATUSES` is the canonical list of valid application outcome values. The jobs-service validates against this array on `PUT /applications/:id/outcome`, and the Kanban board uses it to define the column list.

### `shared/types/index.d.ts`

TypeScript type declarations. None of the services are written in TypeScript — these types serve as documentation and IDE support for editors that understand `.d.ts` files.

Key types:
- `OutcomeStatus` — `'pending' | 'ghosted' | 'rejected' | 'interview' | 'offer'`
- `User` — `{ id: string; email: string; ats_score_cache?: number; created_at: Date }`
- `Application` — all columns from the applications table
- `ApplicationLoggedEvent` — `{ userId, applicationId, jdFingerprintHash, roleBucket, atsPlatform }` — the payload published to the `application.logged` queue
- `OutcomeUpdatedEvent` — `{ userId, applicationId, outcome, responseDays? }`
- `PatternComputedEvent` — `{ cohortId, skillCluster, roleBucket, patternId }`

---

## 6. Web Pages in Detail

The six page components live in `web/src/pages/`. All are lazy-loaded. All protected pages can call `useAuth()` to get `{ user }`.

### LoginPage and RegisterPage

Both are thin forms that delegate entirely to `AuthContext`.

**LoginPage:**
- Two controlled inputs: email, password.
- On submit: calls `login(email, password)` from `useAuth()`.
- On success: `navigate('/dashboard')`.
- On error: displays the axios error message below the form.
- No direct `client` usage — auth calls go through the context.

**RegisterPage:**
- Same pattern as LoginPage, calls `register(email, password)`.
- Client-side password validation: minimum 8 characters, checked before submission to avoid a round-trip.
- On success: `navigate('/dashboard')`.

### DashboardPage

The home screen after login. Fetches three things in parallel on mount:

```js
// Three concurrent fetches
client.get('/users/me')
client.get('/applications/stats')
client.get('/applications?limit=6')
```

Each has its own loading/error state. The page renders progressive disclosure — the greeting section appears as soon as `GET /users/me` resolves, and the stat cards appear when `/applications/stats` resolves, without waiting for all three.

**What it shows:**
- Personalised greeting using `user.name ?? user.email`
- ATS score ring: a circular SVG gauge showing `user.ats_score_cache`. If no resume uploaded, shows an empty ring with an upload prompt linking to `/dashboard/profile`.
- Four stat cards with `CountUp` animation (numbers animate from 0 to their value on load): Total Applications, Interviews, Ghosted, Offers.
- Recent applications list (last 6): company name, role title, applied date, outcome badge (colour-coded by status), ATS score badge.
- "View all" link to `/dashboard/tracker`.

**Skeleton loading:** While fetching, placeholder grey blocks render in the shape of the expected content. This prevents layout shift when data arrives.

### KanbanPage

The application tracker. A drag-and-drop board with five columns corresponding to `OUTCOME_STATUSES`.

**Data fetching:**
```js
client.get('/applications')  // no limit — fetches all
```

Applications are grouped by `outcome` into column data structures.

**Drag-and-drop library:** `@hello-pangea/dnd` (a maintained fork of `react-beautiful-dnd`).

**Optimistic updates:** When a card is dragged to a new column:
1. Local state updates immediately (card moves in the UI).
2. `PUT /applications/:id/outcome` fires asynchronously.
3. If the PUT fails (network error, 404), the card snaps back to its original column.

This means the user sees the move instantly without waiting for the server, and reverts gracefully on failure.

**Column order:** Applied → Interview → Offer → Rejected → Ghosted. The rightmost columns represent terminal states.

### InsightsPage

Lighter than its name suggests — the actual AI-generated insight cards are in the user's profile (fetched via `GET /users/me/insights` in user-service). The InsightsPage in the web app renders a full-screen interactive globe showing geographic job application density.

The globe is rendered with Three.js, loaded lazily (`lazy(() => import('../components/WorldGlobe'))`) because the Three.js bundle is large. Spinning globe with coloured dots at cities where applications were submitted, driven by the `applications.page_url` field's extracted domain (geocoded to city coordinates by a lookup map).

No direct API call from this page — globe data is injected from the applications already fetched elsewhere in the session.

### OpportunitiesPage

The most feature-rich page. Fetches three things and contains an inline AI call.

**Data fetching on mount:**
```js
// 1. Get user's skills from resume (optional — personalises recommendations)
client.get('/users/me/resume')

// 2. Get skill recommendations based on those skills
client.get(`/opportunities?skills=${skills.join(',')}&interests=${interests.join(',')}`)

// 3. Get community matches
client.get(`/opportunities/communities?skills=${skills.join(',')}`)
```

The skills come from `resumeJson.skills` — an array of strings extracted during PDF parsing.

**UI layout:** Split page.
- **Left column — skill recommendations:** Each skill shows as a card with:
  - Skill name, level badge (Foundational/Intermediate/Advanced), domain tag
  - `dataSource` indicator: a green "Cohort data" chip if backed by real applicant data, grey "Heuristic" chip otherwise
  - Reason text (only for cohort-backed recommendations): "Adding React increases your offer rate by 31% in your cohort"
  - Three course links with platform badges and free/paid indicators

- **Right column — communities:** Each community card shows name, platform badge (Discord/Slack), description, matching tags, and a "Join" button linking to `joinUrl`.

- **Hidden curriculum decoder:** A section with five topic buttons. Clicking any button calls:
  ```js
  client.post('/agent/explain-hiring-process', { topic: selectedTopic })
  ```
  The response text is extracted from the model output (`choices[0].message.content` for Tier 2) and displayed in a expanding text block. This is the same endpoint documented in Notebook 4, Section 2. The five topics are: `behavioral round`, `recruiter first-30-seconds screen`, `talking about a project`, `what culture fit means`, `following up after an interview`.

### ProfilePage

The most data-heavy page. Four fetches on mount:

```js
client.get('/users/me/resume')     // resume JSON (skills, work experience, education)
client.get('/applications')        // all applications for ATS score chart
client.get('/users/me')            // profile fields (name, target_role, etc.)
```

**Left column — resume and ATS:**
- Resume upload section: drag-and-drop dropzone (click or drop a PDF). On drop, sends `POST /users/me/resume` as `FormData` with content-type `multipart/form-data`. Shows a progress indicator during upload. On success, updates the displayed resume data without a full page reload.
- ATS ring: same SVG gauge as DashboardPage, shows `atsScore` from the upload response.
- ATS score history chart: Recharts `LineChart` of the last 10 applications' `ats_score_at_apply` values over time, giving a trend of whether the user's resume is improving relative to the jobs they're applying for.

**Right column — profile form and extracted resume data:**
- Profile edit form: name, target_role, target_location, years_of_experience, cover_letter_template (textarea with `{{company}}` and `{{role}}` placeholder hints). Submit calls `PUT /users/me` with only the changed fields.
- Extracted skills: chips for each skill in `resumeJson.skills`. Read-only — updated by re-uploading a resume.
- Work experience: list of `{ company, title, startDate, endDate, description }` from `resumeJson.workExperience`.
- Education: list of `{ institution, degree, field, graduationYear }` from `resumeJson.education`.

---

## 7. Mobile App

### Navigation structure

`mobile/App.jsx` wraps the entire app in `AuthProvider` and `NavigationContainer`. Navigation adapts to auth state:

**Auth stack (when no token):**
- `LoginScreen` — only screen; no back button

**App stack (when token is present):**
- `HomeScreen` — main screen, listed first so it shows first after login
- `LogScreen` — accessed via the "Log Activity" button on HomeScreen

The switch between stacks happens automatically when `signIn()` or `signOut()` is called — the navigation tree re-evaluates and swaps stacks. No manual `navigate()` call needed.

Header styling: dark background (`#1a1a2e`), white title text, no elevation shadow.

### Auth context (`mobile/src/utils/AuthContext.jsx`)

Unlike the web app's `AuthContext`, the mobile version uses Expo's `SecureStore` for token persistence. SecureStore encrypts data using the device's secure enclave — much more secure than `localStorage`.

```js
async function signIn(token) {
  await SecureStore.setItemAsync('auth_token', token);
  setToken(token);
}

async function signOut() {
  await SecureStore.deleteItemAsync('auth_token');
  setToken(null);
}
```

On app startup, `useEffect` reads `SecureStore.getItemAsync('auth_token')` to restore the session. `loading` is `true` until this completes — the navigation tree is not rendered during this window to prevent flicker.

Storage utilities are in `mobile/src/utils/storage.js`:
- `saveToken(token)` → `SecureStore.setItemAsync('auth_token', token)`
- `getToken()` → `SecureStore.getItemAsync('auth_token')`
- `clearToken()` → `SecureStore.deleteItemAsync('auth_token')`

### API client (`mobile/src/api/client.js`)

Same shape as the web client. One key difference: the request interceptor is `async` because `getToken()` returns a Promise (SecureStore is async, unlike the synchronous `localStorage`):

```js
client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

Base URL from `EXPO_PUBLIC_API_URL` or `http://localhost:3000`. Physical devices cannot use `localhost` — see Notebook 5, Section 7 for the LAN IP workaround.

### LoginScreen

- Two TextInput components: email (keyboardType `email-address`, autoCapitalize `none`), password (secureTextEntry).
- "Sign in" button calls `POST /auth/login` directly via the API client (not through a context method — simpler than the web version since there's no AuthContext login function).
- On success: extracts `token` from `res.data.data.token`, calls `signIn(token)`, navigation auto-swaps.
- On error: `Alert.alert('Login failed', err.response?.data?.message ?? err.message)`.

### HomeScreen

The main screen after login. Re-fetches data every time the screen gains focus.

**Data fetching:**
```js
useFocusEffect(useCallback(() => {
  client.get('/users/me')
  client.get('/applications?limit=10')
}, []));
```

`useFocusEffect` from React Navigation fires each time the screen comes into focus — including when navigating back from LogScreen. This means logging a new application via LogScreen and pressing back immediately shows the new entry in the home list.

**What it shows:**
- Greeting: "Good morning, [name]" / "Good afternoon, [name]" / "Good evening, [name]" based on `new Date().getHours()`.
- `StreakCard` component (see below).
- "Log Activity" button → navigates to LogScreen.
- Recent applications list (last 10): company, role, applied date, status dot (colour-coded).
- "Sign out" button → calls `signOut()`, navigation swaps back to auth stack.

Pull-to-refresh: `<ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>`. Pulling down re-triggers the data fetch.

### StreakCard Component

A self-contained component rendered on HomeScreen. Computes streak from the applications array passed as a prop.

**Streak logic:**
- Sorts applications by `applied_at` date.
- Groups by calendar date (ISO date prefix: `applied_at.split('T')[0]`).
- Counts consecutive days with at least one application, backwards from today.
- `currentStreak` — consecutive days ending today or yesterday.
- `bestStreak` — longest run of consecutive days in the full history.

**14-day heatmap:**
- Generates the last 14 calendar days.
- For each day, checks if any application was submitted that day.
- Renders a 14-element grid of small squares: filled (purple/accent colour) if active, empty (grey) if no application that day.

**Display:**
```
47 🔥         Best: 12 days

[heatmap: 14 squares, 9 filled]
```

### LogScreen

A simple form for quickly logging a new application from the phone — lighter than the web dashboard, no JD text or resume features.

**Form fields:**
- Company name (required, TextInput)
- Role title (required, TextInput)
- Status selector (chip buttons, one active at a time): Applied / Interviewing / Offer / Rejected
- Notes (optional, multiline TextInput)

Default status: `applied`.

**On submit:**
```js
client.post('/applications', { companyName, roleTitle })
```

Only `companyName` and `roleTitle` are sent. Status is not sent — mobile applications always log as `pending` initially and are updated via the web tracker. Notes are stored locally only (not persisted to the API in the current implementation).

On success: `navigation.goBack()`, which triggers HomeScreen's `useFocusEffect` to refresh the list.

---

## 8. Resume Parser

`services/user/src/utils/resumeParser.js` takes raw text output from `pdf-parse` and extracts structured data.

### `parseResumeText(rawText)`

Returns:
```js
{
  skills:         ['JavaScript', 'TypeScript', 'React', ...],
  workExperience: [{ company, title, startDate, endDate, description }],
  education:      [{ institution, degree, field, graduationYear }],
}
```

**Skills extraction:**
Looks for a "Skills" section header (regex on common patterns: "Skills", "Technical Skills", "Core Competencies"). Extracts the lines following the header until the next section. Skills are split on commas, pipes, or bullet characters, trimmed, filtered to 2–40 characters, deduplicated. Falls back to a keyword scan across the entire text using a known-skill dictionary if no section header is found.

**Work experience extraction:**
Looks for section headers: "Experience", "Work Experience", "Employment History". Each job entry is identified by date patterns (e.g., `Jan 2021 – Mar 2023`, `2019 – Present`). The company and title are extracted from the lines before the dates using heuristics (company name is typically all-caps or follows "at"). Description is the block of text between date lines.

**Education extraction:**
Looks for "Education" section header. Degree keywords (Bachelor, Master, B.S., M.S., MBA, PhD) and institution name patterns are used to extract entries. Graduation year is a 4-digit number after or near the degree line.

### `resumeQualityScore(parsed)`

Returns 0–100 based on completeness:
- Has any skills: +30 points
- Has at least 5 skills: +10 more (up to +40 total for skills)
- Has at least one work experience entry: +30 points
- Has at least 2 work experience entries: +10 more
- Has education: +20 points
- Maximum: 100

This score is stored in `users.ats_score_cache` for quick display on the dashboard. It is overwritten each time a resume is uploaded.

---

## 9. Error and Response Helpers

All services use a consistent response format. The helpers are typically defined in a `utils/response.js` file in each service.

### Success response

```js
function sendSuccess(res, statusCode, data) {
  res.status(statusCode).json({ status: 'success', data });
}
```

Example:
```json
HTTP 200
{
  "status": "success",
  "data": {
    "user": { "id": "...", "email": "..." },
    "token": "eyJ..."
  }
}
```

### Error response

```js
function sendError(res, statusCode, message, details = undefined) {
  res.status(statusCode).json({ status: 'error', message, ...(details && { details }) });
}
```

Example:
```json
HTTP 400
{
  "status": "error",
  "message": "password must be at least 8 characters"
}
```

`details` is optional — used for validation errors where multiple fields failed:
```json
HTTP 400
{
  "status": "error",
  "message": "Validation failed",
  "details": [
    { "field": "email",    "message": "Invalid email format" },
    { "field": "password", "message": "Too short" }
  ]
}
```

This shape is what the axios client receives. On the frontend, `err.response.data.message` always gives the human-readable error string.

---

## 10. The Test Suite

### What exists

Two test files, one per service:

- `services/user/src/__tests__/auth.test.js`
- `services/jobs/src/__tests__/applications.test.js`

Both use Jest + Supertest. The tests are integration-style (they make HTTP requests to the actual Express app) but mock all external dependencies (database, Redis, BullMQ).

### Running the tests

From the repo root:
```bash
npm test --workspace=@gbm/user-service
npm test --workspace=@gbm/jobs-service
```

Or from the service directory:
```bash
cd services/user
npm test
```

### How mocking works

Each test file mocks modules before importing the app. The mocking pattern:

```js
// Mock the db module before requiring the app
jest.mock('../db/users.db', () => ({
  findUserByEmail:  jest.fn(),
  createUser:       jest.fn(),
  findUserById:     jest.fn(),
}));

jest.mock('bcrypt', () => ({
  hash:    jest.fn().mockResolvedValue('$2b$12$hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

const app = require('../../index');
```

The app is required *after* the mocks are set up, so when index.js imports its dependencies, it gets the mocked versions.

In each test, mocked functions are configured with `mockResolvedValue` or `mockResolvedValueOnce` to return the expected data:

```js
it('returns 201 on valid register', async () => {
  usersDb.findUserByEmail.mockResolvedValueOnce(null);   // email not taken
  usersDb.createUser.mockResolvedValueOnce({
    id: 'user-uuid', email: 'test@example.com', created_at: new Date(),
  });

  const res = await request(app)
    .post('/auth/register')
    .send({ email: 'test@example.com', password: 'password123' });

  expect(res.status).toBe(201);
  expect(res.body.data.token).toBeDefined();
  expect(res.body.data.user.hashed_password).toBeUndefined();
});
```

### Auth test cases (10 total)

| Test | Input | Expected |
|------|-------|---------|
| Valid register | `{ email, password: 'password123' }` | 201, token present, hashed_password absent |
| Duplicate email | email already in mock DB | 409, message "Email already registered" |
| Invalid email format | `{ email: 'notanemail', password }` | 400 |
| Password too short | `{ email, password: '1234' }` | 400, message about 8 chars |
| Empty body | `{}` | 400 |
| Valid login | correct credentials | 200, token present, hashed_password absent |
| Wrong password | bcrypt.compare returns false | 401, message "Invalid credentials" |
| Non-existent user | findUserByEmail returns null | 401, message "Invalid credentials" — same as wrong password (no enumeration) |
| Missing email | `{ password }` | 400 |
| Empty login body | `{}` | 400 |

### Applications test cases (8 total)

The applications tests simulate the gateway's auth injection by setting the `x-user-id` header on each request:

```js
const res = await request(app)
  .post('/applications')
  .set('x-user-id', 'test-user-id')  // simulates gateway auth middleware
  .send({ companyName: 'Stripe', roleTitle: 'Engineer' });
```

| Test | Input | Expected |
|------|-------|---------|
| Valid application | `{ companyName, roleTitle }` | 201, application in data |
| Missing companyName | `{ roleTitle }` | 400 |
| Missing roleTitle | `{ companyName }` | 400 |
| Empty body | `{}` | 400 |
| Get applications (with data) | GET /applications | 200, array with items |
| Get applications (empty) | DB returns [] | 200, empty array |
| Update outcome (valid) | `{ outcome: 'ghosted' }` | 200, updated application |
| Update outcome (not found) | DB returns 0 rows | 404 |
| Update outcome (invalid enum) | `{ outcome: 'maybe' }` | 400 |

### What's not tested

No test files exist for: opportunity-service, agent-service, intelligence-service, gateway (integration), the frontend React components, the Chrome extension, or the mobile app. The Playwright dependency in `package.json` (`@playwright/test`, `playwright`) suggests end-to-end tests were planned but not written.

To add tests for a new service, follow the same pattern: mock `../db/`, `bcrypt`, and any queue producers; require the app after mocks are set; use Supertest for HTTP assertions; set `x-user-id` to simulate authenticated requests.

---

## 11. Cross-Cutting Patterns

### Config validation on startup

Every service (user, jobs, opportunity, agent, intelligence) validates required env vars at the top of `index.js`:

```js
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL'];
for (const key of REQUIRED) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}
```

This causes the container to crash on startup with a clear error message rather than silently operating in a broken state (e.g., connecting to no database and returning 500 on every request).

### Service identity via injected headers

Services never verify JWTs. The gateway verifies the JWT once, then injects:
- `x-user-id: <userId>` — the user's UUID from the JWT `sub` field
- `x-user-email: <email>` — the user's email

Services read `req.headers['x-user-id']` for every query that needs the authenticated user. This means:
1. JWT verification logic exists in only one place (gateway).
2. Services are lighter (no JWT library needed for verification — only user-service needs it for signing).
3. Services that receive forged `x-user-id` headers from anything other than the gateway would be exploitable — but since services are on the internal Docker network with no host ports exposed, external traffic cannot reach them directly.

### Database connection pooling

Every service that uses Postgres initialises one pool at startup:

```js
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => {
  console.error('Unexpected postgres client error', err);
  process.exit(1);
});
```

The pool is lazy — it doesn't connect until the first query. `pool.on('error')` catches unexpected disconnections (e.g., Postgres restarting) and crashes the service process, relying on Docker's `restart: unless-stopped` to bring it back. This is simpler than implementing reconnection logic.

Pool size: default (`max: 10`) — not configured explicitly. On a CX22 with five services each holding up to 10 connections, the theoretical maximum is 50 connections, which is within Postgres 15's default `max_connections = 100`.

### BullMQ connection pattern

Jobs-service and intelligence-service both connect to Redis via BullMQ. Each creates a separate Redis connection:

```js
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,  // required by BullMQ
});
```

`maxRetriesPerRequest: null` disables IORedis's built-in request retry — BullMQ handles its own retry logic and needs this disabled to function correctly.
