# Notebook 2 — Database: Schema, Queries, and Patterns

All services share a single PostgreSQL 15 instance. There is no ORM — every query is hand-written SQL using the `pg` driver's parameterised `$1, $2, ...` placeholders, which means there is no N+1 risk from lazy loading but also no schema-level type safety. Everything in this document is derived from the actual migration files and database layer source code.

---

## 1. Every Table

### `users`
*Owned by: user-service (reads and writes). Also read by intelligence-service (resume_json for PII stripping and skill matching).*

What lives here: one row per registered user. The profile grows over time through migrations — the original row has email, password hash, and timestamps; subsequent migrations added name, job-search preferences, and a cover-letter template.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | Auto-generated at INSERT |
| `email` | VARCHAR | UNIQUE NOT NULL | Case-sensitive in storage; lowercased by application logic on lookup |
| `hashed_password` | VARCHAR | NOT NULL | bcrypt output, never returned to callers |
| `resume_json` | JSONB | nullable | Full structured resume extracted from PDF upload. Structure includes a `skills` array used for insight matching |
| `ats_score_cache` | INTEGER | nullable | Latest ATS score from the most recent job description score — cached to avoid recomputing |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | |
| `name` | VARCHAR | nullable | Added in migration 009 |
| `target_role` | VARCHAR | nullable | Added in migration 009 — e.g. "Frontend Engineer" |
| `target_location` | VARCHAR | nullable | Added in migration 009 |
| `years_of_experience` | INTEGER | nullable | Added in migration 009 |
| `cover_letter_template` | TEXT | nullable | Added in migration 010 — user-written template passed to cover letter generation |

---

### `companies`
*Owned by: jobs-service (reads and writes). Also read by agent-service for outreach signal context.*

What lives here: one row per company. Companies are created lazily — `findOrCreateCompany()` inserts a row the first time a user logs an application to a company. The analytics columns (`ghost_rate`, `avg_response_days`, `size_band`) start as NULL and are populated by a separate process over time.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | |
| `name` | VARCHAR | NOT NULL | Stored as trimmed original casing; looked up using LOWER() |
| `ats_platform` | VARCHAR | nullable | e.g. 'greenhouse', 'lever', 'workday' |
| `ghost_rate` | FLOAT | nullable | Fraction of applications that received no response — computed externally |
| `avg_response_days` | FLOAT | nullable | Average days to first response |
| `size_band` | INTEGER | nullable | Company size category (e.g. 1=startup, 2=mid, 3=enterprise) |

No unique constraint on `name`. The lookup uses `LOWER(name) = $1`, so two companies with the same normalised name will match. If the SELECT returns no row, a new row is inserted — this is not atomic and could create a duplicate under concurrent writes, but the risk is accepted given low concurrency.

---

### `applications`
*Owned by: jobs-service (all reads and writes).*

What lives here: one row per job application. This is the Kanban board data. Every application belongs to exactly one user and one company.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | |
| `user_id` | UUID | NOT NULL REFERENCES users(id) ON DELETE CASCADE | Cascade: deleting a user deletes all their applications |
| `company_id` | UUID | NOT NULL REFERENCES companies(id) | No cascade — company row stays even if all its applications are gone |
| `role_title` | VARCHAR | NOT NULL | Free text, e.g. "Senior Frontend Engineer" |
| `jd_fingerprint_hash` | VARCHAR | nullable | TF-IDF fingerprint of the job description text, used for deduplication |
| `ats_score_at_apply` | INTEGER | nullable | Score at the time of application — snapshot so it doesn't change when resume is updated |
| `outcome` | VARCHAR | NOT NULL DEFAULT 'pending' | CHECK constraint enforces exactly five values: `pending`, `ghosted`, `rejected`, `interview`, `offer` |
| `response_days` | INTEGER | nullable | Set when outcome is updated; NULL while pending |
| `applied_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | |

**Indexes on `applications`:**
- `idx_applications_user_id` on `(user_id)` — added in migration 004, covers the single-column user filter
- `idx_applications_company_id` on `(company_id)` — added in migration 004, covers the JOIN to companies
- `idx_applications_user_applied` on `(user_id, applied_at DESC)` — added in migration 008, covering index for the most common query shape: filter by user_id, sort by date descending. Faster than the single-column index for this access pattern because Postgres can satisfy both the WHERE and the ORDER BY from the index alone.

---

### `cohort_patterns`
*Owned by: intelligence-service (writes). Read by: user-service (joined into insight card responses), opportunity-service (personalised recommendations).*

What lives here: one row per unique combination of `(role_bucket, skill_cluster, pattern_type)`. Each row represents an aggregated finding about what happens to a specific type of applicant. The nightly job overwrites the `finding` JSONB column in-place using an upsert — the row count stays stable, but the data is refreshed.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | |
| `role_bucket` | VARCHAR | NOT NULL | Normalised role category, e.g. 'software.engineer' |
| `skill_cluster` | VARCHAR | NOT NULL | Derived from resume skills, e.g. 'javascript.typescript' |
| `pattern_type` | VARCHAR | NOT NULL | e.g. 'outcome_distribution', 'skill_impact' |
| `finding` | JSONB | NOT NULL | Computed statistics: `{ ghost_rate, rejection_rate, avg_ats_score, ghosted_count, ... }` |
| `cohort_size` | INTEGER | NOT NULL | Number of application_events that contributed to this pattern |
| `computed_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Refreshed on every nightly upsert |
| UNIQUE | `(role_bucket, skill_cluster, pattern_type)` | | The conflict target for the upsert — one pattern per bucket/cluster/type combination |

---

### `user_insights`
*Owned by: intelligence-service (writes). Read by: user-service.*

What lives here: one row per user per pattern — the insight cards shown on the dashboard. When the nightly pipeline produces a new pattern, it creates a user_insights row for every user whose skills match that pattern's skill_cluster. The `seen` flag tracks whether the user has dismissed the card.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | |
| `user_id` | UUID | NOT NULL REFERENCES users(id) ON DELETE CASCADE | Cascade: deleting a user deletes all their insight cards |
| `pattern_id` | UUID | NOT NULL REFERENCES cohort_patterns(id) | No cascade — pattern stays if a user is deleted |
| `headline` | VARCHAR | NOT NULL | The card title, e.g. "75% of javascript, typescript applicants are ghosted" |
| `action` | VARCHAR | NOT NULL | The actionable recommendation text |
| `seen` | BOOLEAN | NOT NULL DEFAULT FALSE | |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | |
| `source` | VARCHAR | DEFAULT 'templated' | Added in migration 011. Value is always 'templated' currently (template-generated text). Reserved for future AI-generated source |
| UNIQUE | `(user_id, pattern_id)` | | Prevents duplicate insight cards if the pipeline runs twice |

**Index on `user_insights`:**
- `idx_user_insights_user_id` on `(user_id)` — added in migration 008. Without this, fetching insights for one user requires a full table scan across all users' cards.

---

### `skill_demand`
*Owned by: jobs-service (reads). Write mechanism not in this codebase — populated externally.*

What lives here: aggregated supply-and-demand data for skills, broken down by region and week. Used for the skill leaderboard on the dashboard.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | |
| `skill` | VARCHAR | NOT NULL | e.g. 'TypeScript', 'Python' |
| `region` | VARCHAR | NOT NULL | e.g. 'US', 'EU', 'IN' |
| `open_roles` | INTEGER | NOT NULL | Count of open roles requiring this skill this week |
| `applicant_pool` | INTEGER | NOT NULL | Estimated count of applicants with this skill in this region |
| `heat_score` | FLOAT | NOT NULL | Derived demand signal (open_roles / applicant_pool ratio or similar) |
| `week` | DATE | NOT NULL | ISO week start date for this snapshot |

**Index:** `idx_skill_demand_skill_region` on `(skill, region)`.

---

### `application_events`
*Owned by: intelligence-service (all reads and writes). No other service touches this table.*

What lives here: anonymised analytics events, one per application. This is the analytics ledger that powers the nightly cohort computation. It deliberately contains no user-identifying information — there is no `user_id` column. Instead, `anonymised_cohort_id` is a hashed identifier that groups events without revealing who submitted them.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `application_id` | UUID | PRIMARY KEY | **NOT auto-generated.** The value comes from `applications.id`, so the same UUID that identifies the application in the main tracker also identifies its analytics event here |
| `anonymised_cohort_id` | VARCHAR | nullable | Hashed/anonymised user identifier. Not a foreign key — intentionally decoupled from the users table |
| `role_bucket` | VARCHAR | NOT NULL DEFAULT 'unspecified' | Normalised role category |
| `skill_cluster` | VARCHAR | nullable | Derived from the user's resume skills at time of submission |
| `ats_score` | INTEGER | nullable | ATS score at time of application |
| `company_size_band` | INTEGER | nullable | Company size category from the companies row |
| `ats_platform` | VARCHAR | NOT NULL DEFAULT 'unknown' | ATS platform name from the companies row |
| `outcome` | VARCHAR | NOT NULL DEFAULT 'pending' | Starts as 'pending', updated by `updateApplicationOutcome()` |
| `response_days` | INTEGER | nullable | Starts as NULL, updated when outcome is set |
| `applied_at` | TIMESTAMP | NOT NULL | Copied from the original application row |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | |

**Index:** `idx_app_events_cohort` on `(role_bucket, skill_cluster, ats_platform)` — exactly the three columns in the GROUP BY clause of the nightly computation query.

---

### `migrations` (internal)
*Created and owned by `scripts/migrate.js`. No service code reads it.*

What lives here: the record of which migration files have been applied. The migration runner creates this table if it does not exist, then checks it before running each SQL file. This is what makes migrations idempotent — a file already in this table is skipped, not re-run.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | SERIAL | PRIMARY KEY |
| `filename` | VARCHAR | NOT NULL UNIQUE |
| `applied_at` | TIMESTAMP | NOT NULL DEFAULT NOW() |

---

## 2. The Migration History

Migrations run in alphabetical filename order. Each one is wrapped in a single `BEGIN` / `COMMIT` transaction. If any statement fails, the transaction rolls back and the file is not recorded in `migrations`, so the next run will retry it from scratch.

**001 — uuid-ossp extension**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```
Installs the extension that provides `uuid_generate_v4()`. This runs before any table creation because every table's primary key uses that function as its default. If this migration were skipped, all subsequent `INSERT` statements relying on the default would fail.

**002 — users table**
Creates the core identity table. The `resume_json JSONB` column is nullable from day one because users sign up before uploading a resume. `ats_score_cache` is also nullable — it's populated the first time a user scores a job description.

**003 — companies table**
Creates the company registry. All analytics columns (`ghost_rate`, `avg_response_days`, `size_band`) are nullable because companies are created lazily with minimal data and enriched later.

**004 — applications table + two indexes**
Creates the Kanban tracker table. Introduces the first foreign keys: `user_id → users.id` with `ON DELETE CASCADE` (user deletion cascades), and `company_id → companies.id` with no cascade (companies persist). The `outcome` column has a `CHECK` constraint enforcing the five legal values. Two indexes are created immediately — user_id and company_id — because they will be hit on every query from day one.

**005 — cohort_patterns table**
Creates the analytics output table. The `UNIQUE (role_bucket, skill_cluster, pattern_type)` constraint is the foundation of the upsert strategy — the nightly job uses this as the `ON CONFLICT` target to refresh rows in-place rather than accumulating duplicates.

**006 — user_insights table**
Creates the insight card table. References both `users` (cascade) and `cohort_patterns` (no cascade). The `UNIQUE (user_id, pattern_id)` constraint prevents the insight fan-out from creating duplicate cards if the pipeline runs more than once.

**007 — skill_demand table**
Creates the skill leaderboard table. No foreign keys — this is populated by an external process, independent of user data.

**008 — missing indices (hardening pass)**
Added after profiling showed two access patterns without adequate index coverage:
- `idx_user_insights_user_id` — every "get my cards" query filters by user_id; without this index the query scanned the entire table.
- `idx_applications_user_applied` on `(user_id, applied_at DESC)` — a composite covering index that satisfies both the WHERE clause and the ORDER BY in the most common application list query. Supersedes the single-column `idx_applications_user_id` for date-sorted queries.

**009 — user profile fields**
```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name                VARCHAR,
  ADD COLUMN IF NOT EXISTS target_role         VARCHAR,
  ADD COLUMN IF NOT EXISTS target_location     VARCHAR,
  ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;
```
Adds job-search preference columns. All nullable — existing users have no data in these columns until they fill in their profile. `ADD COLUMN IF NOT EXISTS` means re-running this migration is a no-op.

**010 — cover letter template**
```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cover_letter_template TEXT;
```
Adds the column that stores the user's saved cover letter template. Uses `TEXT` rather than `VARCHAR` because there is no meaningful maximum length.

**011 — insight source column**
```sql
ALTER TABLE user_insights
  ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'templated';
```
Adds a provenance column to track how insight text was generated. The default `'templated'` is applied to all existing rows retroactively. Reserved for a future `'ai_generated'` value.

**012 — application_events table**
Replaces the ClickHouse analytics store with a Postgres table. The primary key is `application_id UUID` with no default — the caller supplies the value from `applications.id`. The composite index on `(role_bucket, skill_cluster, ats_platform)` mirrors the GROUP BY in the nightly computation query.

---

## 3. Foreign Key Relationships

There are four foreign key relationships in the schema.

**`applications.user_id → users.id` — ON DELETE CASCADE**
Every application belongs to a user. If a user account is deleted, all of their applications are deleted automatically by the database. This means the service layer does not need to delete applications separately — one `DELETE FROM users WHERE id = $1` removes the user and all their tracker data in a single statement.

**`applications.company_id → companies.id` — no CASCADE**
Every application references a company. If a company row were deleted, Postgres would reject the delete with a foreign key violation error — you cannot delete a company that has applications pointing to it. In practice, companies are only created, never deleted, so this constraint is never hit.

**`user_insights.user_id → users.id` — ON DELETE CASCADE**
Like applications, insight cards belong to a user. Deleting a user also deletes all their insight cards. This keeps the `user_insights` table clean without any application-layer cleanup logic.

**`user_insights.pattern_id → cohort_patterns.id` — no CASCADE**
Each insight card references the pattern that generated it. If a `cohort_patterns` row were deleted, any `user_insights` rows referencing it would violate the constraint. In practice, patterns are upserted (never deleted), so this is not hit. The relationship exists primarily to allow the JOIN query in `getInsightsByUserId` to pull pattern metadata alongside the card text.

**`application_events` has no foreign keys — intentional.**
The `application_id` column holds the same UUID value as `applications.id`, but there is no `REFERENCES applications(id)` constraint. This is a deliberate architectural decision: analytics events are decoupled from the application tracker. If an application row is later deleted (user account deletion cascades), the analytics row stays, preserving the cohort data for the nightly computation. The two tables can drift independently.

---

## 4. Query Patterns

### User Service

**Login — look up by email:**
```sql
SELECT id, email, hashed_password, ats_score_cache, created_at
FROM users WHERE email = $1
```
Returns one row or null. The caller then runs `bcrypt.compare(password, row.hashed_password)`. Note that `hashed_password` is the only time this column appears in a SELECT — it is never returned to the HTTP response.

**Profile fetch — look up by ID:**
```sql
SELECT
  id, email, name, ats_score_cache,
  target_role, target_location,
  years_of_experience, cover_letter_template, created_at
FROM users WHERE id = $1
```
The user ID comes from the JWT payload (`x-user-id` header injected by the gateway).

**Profile update — dynamic patch:**
The `updateUserProfile` function builds the UPDATE statement dynamically, but safely. It maintains a hardcoded `ALLOWED` array of column names, iterates only over those, and builds parameterised placeholders (`$1`, `$2`, ...) from the index — never from user input. If a caller passes `{ name: 'Alice', unknownField: 'x' }`, only `name` is updated; `unknownField` is silently ignored.

```sql
-- Example with name and target_role:
UPDATE users
SET name = $1, target_role = $2
WHERE id = $3
RETURNING id, email, name, ats_score_cache,
          target_role, target_location,
          years_of_experience, cover_letter_template, created_at
```

**Insight cards fetch (joins two tables):**
```sql
SELECT
  ui.id, ui.headline, ui.action, ui.seen, ui.created_at,
  cp.pattern_type, cp.cohort_size, cp.finding, cp.computed_at
FROM user_insights ui
JOIN cohort_patterns cp ON cp.id = ui.pattern_id
WHERE ui.user_id = $1
ORDER BY ui.seen ASC, ui.created_at DESC
```
Unseen cards (`seen = FALSE = 0`) sort before seen cards (`seen = TRUE = 1`). Within each group, most recently created cards come first.

---

### Jobs Service

**Application list with company data (JOIN + optional pagination):**
```sql
SELECT
  a.id, a.role_title, a.jd_fingerprint_hash, a.ats_score_at_apply,
  a.outcome, a.response_days, a.applied_at,
  c.id AS company_id, c.name AS company_name,
  c.ats_platform, c.ghost_rate, c.avg_response_days
FROM applications a
JOIN companies c ON a.company_id = c.id
WHERE a.user_id = $1
ORDER BY a.applied_at DESC
-- optional: LIMIT $2 OFFSET $3
```
The `idx_applications_user_applied` composite index covers both the WHERE clause and the ORDER BY, so Postgres can satisfy the query without a sort step.

**Aggregate stats — single-pass multi-count:**
```sql
SELECT
  COUNT(*)                                                    AS total,
  COUNT(*) FILTER (WHERE outcome IN ('interview', 'offer'))   AS interviews,
  COUNT(*) FILTER (WHERE outcome = 'ghosted')                 AS ghosted,
  COUNT(*) FILTER (WHERE outcome = 'offer')                   AS offers,
  COUNT(*) FILTER (WHERE outcome = 'rejected')                AS rejected,
  COUNT(*) FILTER (WHERE outcome = 'pending')                 AS pending,
  ROUND(AVG(ats_score_at_apply))                              AS avg_ats_score,
  MAX(ats_score_at_apply)                                     AS best_ats_score
FROM applications
WHERE user_id = $1
```
All eight aggregates are computed in a single table scan. `COUNT(*) FILTER (WHERE ...)` is standard Postgres syntax — equivalent to a `CASE WHEN` inside COUNT but more readable. Note: Postgres returns `COUNT` values as strings (BigInt), so the caller wraps each in `Number()`.

**Find-or-create company (two queries, not atomic):**
```sql
-- 1. Try to find existing
SELECT id, name, ats_platform, ghost_rate, avg_response_days, size_band
FROM companies WHERE LOWER(name) = $1

-- 2. If not found, insert
INSERT INTO companies (id, name, ats_platform)
VALUES ($1, $2, $3)
RETURNING id, name, ats_platform, ghost_rate, avg_response_days, size_band
```

**Outcome update (user-scoped for safety):**
```sql
UPDATE applications
SET outcome = $1, response_days = $2
WHERE id = $3 AND user_id = $4
RETURNING *
```
The `AND user_id = $4` condition is critical — it prevents one user from updating another user's application even if they know the UUID.

---

### Intelligence Service

**Cohort statistics — the nightly aggregation query:**
```sql
SELECT
  skill_cluster, role_bucket, ats_platform,
  COUNT(*)                                                                               AS cohort_size,
  COUNT(*) FILTER (WHERE outcome = 'ghosted')                                            AS ghosted_count,
  COUNT(*) FILTER (WHERE outcome = 'rejected')                                           AS rejected_count,
  COUNT(*) FILTER (WHERE outcome = 'interview')                                          AS interview_count,
  COUNT(*) FILTER (WHERE outcome = 'offer')                                              AS offer_count,
  ROUND((COUNT(*) FILTER (WHERE outcome = 'ghosted'))::numeric  / COUNT(*)::numeric, 3) AS ghost_rate,
  ROUND((COUNT(*) FILTER (WHERE outcome = 'rejected'))::numeric / COUNT(*)::numeric, 3) AS rejection_rate,
  ROUND(AVG(ats_score::numeric), 1)                                                      AS avg_ats_score
FROM application_events
WHERE outcome != 'pending'
  AND applied_at >= NOW() - INTERVAL '90 days'
GROUP BY skill_cluster, role_bucket, ats_platform
HAVING COUNT(*) >= 50
```
Three filtering conditions: excludes pending events (no outcome yet), limits to the last 90 days (stale data would distort current patterns), and requires at least 50 events per group (minimum cohort size for statistical validity). The `idx_app_events_cohort` index on `(role_bucket, skill_cluster, ats_platform)` covers the GROUP BY columns.

**Pattern upsert — refresh, don't accumulate:**
```sql
INSERT INTO cohort_patterns
  (id, role_bucket, skill_cluster, pattern_type, finding, cohort_size, computed_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT (role_bucket, skill_cluster, pattern_type)
DO UPDATE SET
  finding     = EXCLUDED.finding,
  cohort_size = EXCLUDED.cohort_size,
  computed_at = NOW()
RETURNING id
```
If a pattern for this bucket/cluster/type combination already exists, its data is replaced in-place. The `id` UUID stays the same across refreshes — this matters because `user_insights.pattern_id` is a foreign key referencing that UUID.

**User skill matching (JSONB array scan):**
```sql
SELECT id, resume_json
FROM users
WHERE resume_json IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(resume_json->'skills') s
    WHERE LOWER(s) = ANY(ARRAY[$1, $2, ...])
  )
```
`jsonb_array_elements_text(resume_json->'skills')` expands the JSON skills array into a set of rows, then `WHERE LOWER(s) = ANY(...)` checks if any of those rows match the target skills. There is no index on the JSONB column, so this is a full table scan — acceptable at current data scale.

---

## 5. The ON CONFLICT DO NOTHING Pattern in application_events

This is the most important correctness constraint in the database layer. Understanding it requires understanding how BullMQ delivers jobs.

**The problem: at-least-once delivery.**
BullMQ guarantees that every queued job will be processed *at least* once, but not *exactly* once. If a worker processes a job and then crashes before acknowledging completion, BullMQ will re-deliver the same job to another worker instance when it retries. This means `insertApplicationEvent` can be called multiple times with the same `applicationId`.

**What the function always does:**
`insertApplicationEvent` always inserts with `outcome = 'pending'` and `response_days = null`. It knows nothing about what happened after the application was submitted — it only records the moment of submission.

**The two-function lifecycle:**
```
insertApplicationEvent(stripped)
  → Inserts row with outcome='pending', response_days=null

updateApplicationOutcome(applicationId, 'ghosted', 14)
  → UPDATE SET outcome='ghosted', response_days=14
```
These are called from two separate BullMQ queues at different points in time. The first fires when an application is logged; the second fires when the user later marks the application as ghosted.

**What would happen with DO UPDATE:**
```sql
-- WRONG — the original proposal before it was corrected:
ON CONFLICT (application_id) DO UPDATE SET
  outcome       = EXCLUDED.outcome,
  response_days = EXCLUDED.response_days
```
If this were used, the sequence of events would be:
1. Application logged → `insertApplicationEvent` inserts row with outcome='pending'
2. User marks application ghosted after 14 days → `updateApplicationOutcome` sets outcome='ghosted', response_days=14
3. BullMQ retries the original `application.logged` job (worker crashed, network blip, or queue backpressure) → `insertApplicationEvent` runs again with outcome='pending', response_days=null
4. The `DO UPDATE` clause fires → the row's outcome reverts to 'pending', response_days reverts to null
5. The real outcome is permanently lost from analytics — it will never be counted in ghost rates

**What DO NOTHING does:**
```sql
ON CONFLICT (application_id) DO NOTHING
```
If a row with this `application_id` already exists — regardless of what state it's in — the INSERT is a no-op. The existing row is left completely unchanged. Step 4 above becomes: the INSERT is silently ignored, the row stays at outcome='ghosted', response_days=14. The analytics data is preserved.

**The rule:** `insertApplicationEvent` always inserts with `outcome='pending'`. `updateApplicationOutcome` is the only function allowed to change the outcome. These two operations are deliberately isolated. DO NOTHING enforces that isolation at the database level, even when BullMQ's delivery semantics would otherwise violate it at the application level.

---

## 6. Connection Pooling

Every service creates a database connection pool in the same way. The pool file is always at `src/db/pool.js` inside the service directory:

```js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err.message);
  process.exit(1);
});

module.exports = pool;
```

**What `new Pool(...)` does:** The `pg` library creates a pool of reusable TCP connections to Postgres. The default pool size is 10 connections. When your code calls `pool.query(...)`, the pool checks out an idle connection, runs the query, and returns the connection to the pool. You never open or close connections manually — the pool handles that.

**The error handler:** `pool.on('error', ...)` fires when an idle client in the pool encounters an unexpected error (e.g. Postgres restarts and drops the connection). The handler calls `process.exit(1)`, which kills the service. Docker Compose's `restart: unless-stopped` policy then restarts the container. This is an intentional fail-fast design — a service with broken database connectivity should not continue serving requests.

**DATABASE_URL in development:**
```
postgresql://gbm:gbm_secret@localhost:5433/gbmjobhunter
```
Port 5433 (not 5432) because the dev docker-compose binds Postgres to 5433 on the host to avoid conflicts with any locally installed Postgres instance.

**DATABASE_URL in production (inside Docker):**
```
postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```
`postgres` here is the Docker Compose service name, resolved to the container's internal IP address by Docker's built-in DNS on `gbm-network`. Port 5432 is the default Postgres port, used inside the Docker network. The `${...}` values are interpolated from the `.env` file when `docker compose up` runs.

**What happens if the database is unreachable at startup:**
`new Pool(...)` does not immediately open any connections — it is lazy. The pool only tries to connect when the first query runs. However, every service's `index.js` checks for `DATABASE_URL` before anything else and throws if it is missing. If the URL is present but Postgres is down, the first query will fail with a connection error, and whichever request triggered it will get a 500 response. The pool will retry subsequent queries. Services do not crash on query failure — only on the idle-client error event described above.

In production, `docker compose`'s `depends_on: condition: service_healthy` means no service container starts until Postgres passes `pg_isready`. This eliminates the race condition where a service boots and immediately tries to query a database that hasn't finished initialising.

---

## 7. How to Add a New Column Safely

The migration pattern in this codebase is: one SQL file per change, numbered sequentially, using `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS` so the file is idempotent. Here is the step-by-step process.

**Step 1 — Find the next migration number.**
Look at the `migrations/` directory. The current highest number is 012. Your new file will be `013`.

**Step 2 — Write the migration file.**
Create `migrations/013_add_your_column.sql`. Name it something descriptive of what it does. Use `ADD COLUMN IF NOT EXISTS` so the migration is safe to run multiple times (important for dev environments where someone might run `npm run migrate` repeatedly):

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS notes TEXT;
```

If you need a default value for existing rows, add a `DEFAULT` clause:

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
```

If you are creating a new index, use `IF NOT EXISTS`:

```sql
CREATE INDEX IF NOT EXISTS idx_applications_priority
  ON applications(user_id, priority DESC);
```

**Step 3 — Run the migration locally.**
```bash
npm run migrate
```
The runner reads all `.sql` files in alphabetical order, checks the `migrations` table, skips files that have already been applied, and runs the new one inside a `BEGIN/COMMIT` block. If the SQL is wrong, it rolls back and prints the error. Your `migrations` table will not record the file if it failed, so fixing the SQL and re-running `npm run migrate` will retry it.

**Step 4 — Update the service code.**
Add the new column to any relevant `db.js` query. If you are adding it to `users`, update the `SELECT` lists in `findUserById`, `updateUserProfile`'s RETURNING clause, and any other function that returns full user objects. If you are adding it to `updateUserProfile`'s allowed fields, add the column name to the `ALLOWED` array.

**Step 5 — Deploy to production.**
On the VPS, the `deploy.sh` script runs `node scripts/migrate.js` on every deploy after `docker compose up`. Because migrations are idempotent, this is safe — already-applied migrations are skipped, and the new file runs once. The sequence in deploy.sh is: bring up containers first, wait for Postgres to be healthy, then run migrations. This order matters because migrations require a live database.

**What not to do:**
- Do not edit an already-applied migration file. The migration runner checks by filename, not content. If you change `012_create_application_events.sql` after it has been applied, the change will never run — the filename is already in the `migrations` table.
- Do not use `ALTER TABLE ... DROP COLUMN` unless you are prepared for the service to fail if any running process still references that column. Always deploy a code change that stops using the column before removing it in a migration.
- Do not add `NOT NULL` columns without a `DEFAULT` clause on a table that already has rows. Postgres will reject the migration because it cannot fill in the new column for existing rows. Either add a `DEFAULT`, or add the column as nullable and backfill separately.
