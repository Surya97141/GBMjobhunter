# Notebook 3 — The Async Pipeline: Queues, Workers, and the Nightly Computation

The intelligence pipeline is built on BullMQ, which uses Redis as its backing store. There are four queues. Two are triggered by user actions in real time; two are triggered by the nightly scheduler. All workers live in `services/intelligence/src/queues/consumers.js`. All producers live in `services/jobs/src/queues/producer.js` (for the real-time queues) and inside `consumers.js` itself (the nightly worker fires the downstream queue it needs).

---

## 1. All Four Queues

### Queue 1: `application.logged`

**Producer:** jobs-service, via `publishApplicationLogged(payload)` in `services/jobs/src/queues/producer.js`.

**Consumer:** intelligence-service, `applicationLoggedWorker` in `consumers.js`.

**When it fires:** Immediately after `POST /applications` successfully inserts a row into the `applications` table. The jobs service creates the DB row, then publishes to this queue.

**Job payload:**
```js
{
  applicationId:    string,   // UUID — same as applications.id
  userId:           string,   // UUID — identifies the user, used to fetch their resume
  jdFingerprintHash: string,  // TF-IDF fingerprint of the job description text
  atsScoreAtApply:  number,   // ATS score at the time of application
  appliedAt:        string,   // ISO timestamp
}
```

**What the consumer does:**
1. Fetches the user's resume from the database: `usersDb.getResumeByUserId(event.userId)` — a SELECT on the `users` table for `resume_json`.
2. Strips PII: `stripPii(event, resumeJson)` — see Section 3.
3. Inserts the anonymised event: `insertApplicationEvent(stripped)` — writes to `application_events` with `ON CONFLICT (application_id) DO NOTHING`.

**Retry policy:** 3 attempts, exponential backoff starting at 2000ms. Concurrency: 5 (five jobs can be processed in parallel).

**Error handling:** On failure (all 3 attempts exhausted), logs `[Consumer] application.logged job <id> failed: <message>`. The row in `application_events` may be missing for this application until the job succeeds or is manually retried via BullMQ's admin interface.

---

### Queue 2: `outcome.updated`

**Producer:** jobs-service, via `publishOutcomeUpdated(payload)` in `producer.js`.

**Consumer:** intelligence-service, `outcomeUpdatedWorker` in `consumers.js`.

**When it fires:** When the user calls `PUT /applications/:id/outcome` — after the jobs service updates the `applications` row in the tracker, it publishes to this queue.

**Job payload:**
```js
{
  applicationId: string,  // UUID — matches application_events.application_id
  outcome:       string,  // 'ghosted' | 'rejected' | 'interview' | 'offer'
  responseDays:  number,  // days from application to response
}
```

**What the consumer does:**
One call: `updateApplicationOutcome(applicationId, outcome, responseDays)` — runs `UPDATE application_events SET outcome = $1, response_days = $2 WHERE application_id = $3`. This is the only way `outcome` and `response_days` in `application_events` ever change from their initial values of `'pending'` and `null`.

**Retry policy:** 3 attempts, exponential backoff starting at 2000ms. Concurrency: 5.

---

### Queue 3: `nightly-computation`

**Producer:** intelligence-service scheduler, via `setupNightlySchedule()` in `services/intelligence/src/queues/scheduler.js`. Uses BullMQ's `queue.upsertJobScheduler()` with cron pattern `'0 2 * * *'` — fires at 02:00 UTC every day. The scheduler registers itself at service boot and then closes its queue handle; from that point on BullMQ manages the recurring schedule inside Redis without any further application-level involvement.

**Consumer:** intelligence-service, `nightlyJobWorker` in `consumers.js`.

**Job payload:** Empty object `{}`. The nightly job needs no input — it reads from the database directly.

**What the consumer does:**
1. Calls `runNightlyComputation()` — aggregates `application_events`, upserts outcome-distribution patterns into `cohort_patterns`, returns an array of pattern UUIDs.
2. Calls `computeSkillImpactPatterns()` — separate computation over the `applications` table, upserts skill-impact patterns into `cohort_patterns`.
3. Creates a temporary `Queue` handle for `pattern.computed`, adds one job with `{ patternIds, computedAt }`, then immediately closes the Queue handle. This fires the downstream fan-out.

**Retry policy:** 1 attempt (no retries). `removeOnComplete: true` (completed jobs are deleted from Redis). `removeOnFail: 50` (keeps the last 50 failed jobs for inspection).

The single-attempt policy is intentional: re-running the nightly computation produces idempotent results (upserts overwrite), but firing it multiple times a night would needlessly duplicate work and fan-out.

---

### Queue 4: `pattern.computed`

**Producer:** intelligence-service's `nightlyJobWorker` (inside `consumers.js`). This is the only queue in the system where both producer and consumer are in the same service.

**Consumer:** intelligence-service, `patternComputedWorker` in `consumers.js`.

**Job payload:**
```js
{
  patternIds: string[],  // array of cohort_patterns UUIDs produced by the nightly computation
  computedAt: string,    // ISO timestamp of when the nightly run completed
}
```

**What the consumer does:**
One call: `publishInsightsForPatterns(patternIds)` — fetches the pattern rows, finds matching users, generates or templates insight text, and writes rows to `user_insights`. See Section 5 for the full detail.

**Retry policy:** 3 attempts, exponential backoff starting at 2000ms. Default concurrency (1).

---

## 2. The Full Nightly Pipeline

Exact sequence from 02:00 UTC to a user seeing a new insight card:

### Phase 1 — Schedule fires

**02:00 UTC.** BullMQ's internal scheduler reads the cron `'0 2 * * *'` registered in Redis by `setupNightlySchedule()` and adds one job to the `nightly-computation` queue. The intelligence service's `nightlyJobWorker` picks it up.

### Phase 2 — Pattern computation (`runNightlyComputation`)

**Function:** `runNightlyComputation()` in `patternComputation.service.js`.

Calls `queryCohortStats()`, which runs:

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

For each row returned, `buildFinding(row)` converts Postgres string values to JavaScript numbers (`parseFloat`, `parseInt`) — Postgres returns `COUNT` as a string and `ROUND` as a numeric string. This produces a `finding` object.

Then `insightsDb.upsertCohortPattern()` runs for each row:

```sql
INSERT INTO cohort_patterns
  (id, role_bucket, skill_cluster, pattern_type, finding, cohort_size, computed_at)
VALUES ($1, $2, $3, 'outcome_distribution', $4, $5, NOW())
ON CONFLICT (role_bucket, skill_cluster, pattern_type)
DO UPDATE SET
  finding     = EXCLUDED.finding,
  cohort_size = EXCLUDED.cohort_size,
  computed_at = NOW()
RETURNING id
```

The returned UUID is collected. At the end, `runNightlyComputation()` returns the full array of UUIDs for all upserted patterns.

**Tables written:** `cohort_patterns` (upserted, one row per group).

### Phase 3 — Skill impact computation (`computeSkillImpactPatterns`)

**Function:** `computeSkillImpactPatterns()` in `skillImpact.service.js`.

Runs a CTE query against the `applications` and `users` tables (not `application_events`):

```sql
WITH baseline AS (
  SELECT
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE outcome IN ('interview', 'offer')) AS success_count
  FROM applications WHERE outcome <> 'pending'
),
skill_stats AS (
  SELECT
    LOWER(skill.value) AS skill_name,
    COUNT(*) AS sample_size,
    COUNT(*) FILTER (WHERE a.outcome IN ('interview', 'offer')) AS success_count
  FROM users u
  CROSS JOIN LATERAL jsonb_array_elements_text(u.resume_json->'skills') AS skill(value)
  JOIN applications a ON a.user_id = u.id
  WHERE a.outcome <> 'pending'
    AND u.resume_json ? 'skills'
  GROUP BY LOWER(skill.value)
  HAVING COUNT(*) >= 15
)
SELECT
  ss.skill_name,
  ss.sample_size::int AS sample_size,
  (ss.success_count::float / ss.sample_size) AS skill_success_rate,
  (b.success_count::float / NULLIF(b.total_count, 0)) AS baseline_success_rate
FROM skill_stats ss, baseline b
```

For each skill with at least 15 resolved applications, it computes a lift score: `liftScore = skillSuccessRate - baselineSuccessRate`. A positive lift means users with this skill get interviews at an above-average rate. A negative lift means below average.

Each skill is upserted to `cohort_patterns` with `pattern_type = 'skill_impact'` and `role_bucket = 'global'`. These rows share the `cohort_patterns` table but are a different type from the `outcome_distribution` rows above.

**Tables read:** `applications`, `users` (via resume_json JSONB scan).  
**Tables written:** `cohort_patterns` (upserted).

**Note in the source code:** Uses current resume skills, not a point-in-time snapshot. Skills change infrequently enough that this approximation is considered acceptable for v1.

### Phase 4 — Downstream queue fires

After both computations complete, the `nightlyJobWorker` adds one job to `pattern.computed`:

```js
await patternComputedQueue.add('pattern.computed', {
  patternIds,         // all UUIDs from runNightlyComputation (outcome_distribution only)
  computedAt: new Date().toISOString(),
});
```

Note: only the `outcome_distribution` pattern IDs are passed downstream. The `skill_impact` patterns written by `computeSkillImpactPatterns()` are not included in `patternIds` — they are computed but not fan-out to user_insights in this run.

### Phase 5 — Insight fan-out (`publishInsightsForPatterns`)

**Function:** `publishInsightsForPatterns(patternIds)` in `insightPublisher.service.js`.

1. `insightsDb.getPatternsByIds(patternIds)` — SELECT all pattern rows for the given UUIDs.
2. For each pattern:
   a. Split `pattern.skill_cluster` on `.` to recover the individual skills (e.g. `'javascript.typescript.react'` → `['javascript', 'typescript', 'react']`).
   b. `usersDb.getUsersWithSkillsIn(skills)` — JSONB scan to find all users whose resume contains at least one of those skills.
   c. `generateDiagnosis(pattern)` — calls Tier 2 model once for this pattern (not per user). Returns `{ success, headline, action }` or a failure shape.
   d. If the diagnosis succeeded, use `diagnosis.headline` and `diagnosis.action` with `source = 'generated'`. If it failed for any reason (not_configured, parse error, timeout), fall back to `buildHeadline(pattern)` and `buildAction(pattern)` with `source = 'templated'`.
   e. For each user returned:
      - Recompute `buildSkillCluster(user.resume_json)` from the user's actual current resume.
      - Compare against `pattern.skill_cluster`. If they do not match exactly, skip this user — they appeared in the broad JSONB scan because they had one matching skill, but their full skill cluster fingerprint doesn't match this specific pattern.
      - If they match: `insightsDb.createUserInsight({ userId, patternId, headline, action, source })` — INSERT with `ON CONFLICT DO NOTHING` on `(user_id, pattern_id)`.
      - `sendFcmNotification(user.id, headline)` — fires an FCM push notification if `FCM_SERVER_KEY` is set. Errors here are caught and logged but do not stop the loop.

**Tables read:** `cohort_patterns`, `users`.  
**Tables written:** `user_insights`.

### Phase 6 — User sees the card

The next time the user's browser calls `GET /users/me/insights` (routed through the gateway to the user service), `getInsightsByUserId(userId)` runs:

```sql
SELECT
  ui.id, ui.headline, ui.action, ui.seen, ui.created_at,
  cp.pattern_type, cp.cohort_size, cp.finding, cp.computed_at
FROM user_insights ui
JOIN cohort_patterns cp ON cp.id = ui.pattern_id
WHERE ui.user_id = $1
ORDER BY ui.seen ASC, ui.created_at DESC
```

New (unseen) cards sort first. The user sees the new insight card.

---

## 3. The PII Stripping Step

**Function:** `stripPii(event, resumeJson)` in `services/intelligence/src/services/piiStripping.js`.

The `application.logged` queue job carries a payload that contains a user UUID (`userId`). Before any of this data touches `application_events`, it passes through `stripPii`. The function's job is to transform identifiable user data into aggregate-safe data.

**What the input contains:**
```js
event = {
  applicationId:    '...uuid...',  // application ID
  userId:           '...uuid...',  // direct user identifier — must be removed
  jdFingerprintHash: '...',        // TF-IDF fingerprint — used to build cohort ID, then discarded
  atsScoreAtApply:  82,
  appliedAt:        '2024-01-15T10:30:00.000Z',
}
resumeJson = { skills: ['JavaScript', 'TypeScript', 'React', ...], ... }
```

**What `stripPii` returns:**
```js
{
  applicationId:      event.applicationId,       // kept — not a user identifier
  anonymisedCohortId: '<16-char hex>',           // SHA-256(skillCluster + ':' + jdFingerprintHash), truncated
  skillCluster:       'javascript.react.typescript', // top 5 skills, lowercased, sorted, joined with '.'
  atsScore:           event.atsScoreAtApply,     // kept — a number, not identifiable
  atsPlatform:        'unknown',                 // hardcoded — see note below
  outcome:            'pending',                 // hardcoded — always pending at log time
  responseDays:       null,                      // hardcoded — not known yet
  appliedAt:          event.appliedAt,           // kept — a timestamp, not identifiable
}
```

**What is removed and why:**

`userId` is the direct link from an analytics event back to a specific person. Removing it means the `application_events` table cannot be joined to the `users` table to identify who submitted which application. The `anonymisedCohortId` replaces it — it is a deterministic hash of the user's skill cluster and the job's fingerprint, so the same user applying to the same type of job will produce the same cohort ID, enabling grouping without identification.

`jdFingerprintHash` is used only as input to generate `anonymisedCohortId`. It is a fingerprint of the job description content, which could in principle be used to identify a specific job posting. It is not stored.

`roleBucket` is not in the `stripPii` output at all — it is absent from the returned object. When `insertApplicationEvent` is called with the stripped data, `stripped.roleBucket || 'unspecified'` evaluates to `'unspecified'`, so `application_events.role_bucket` defaults to `'unspecified'` for all events. This means the nightly cohort query groups by `role_bucket`, but most rows will share the same `'unspecified'` bucket. This is a current limitation — the role title is available on the application but is not being normalised to a role_bucket and passed through the strip function.

Similarly, `companySizeBand` and `atsPlatform` (from the company record) are not carried through — `atsPlatform` is hardcoded to `'unknown'` in the strip function rather than being looked up from the company.

**The `buildSkillCluster` function:**
Takes the first 5 entries from `resumeJson.skills`, lowercases and trims each, sorts alphabetically, and joins with `.`. The sort ensures that two users with the same skills in different order produce the same cluster string. If `resumeJson` is null or has no `skills` array, returns `'unknown'`.

**The `anonymiseCohortId` function:**
```js
crypto.createHash('sha256')
  .update(`${skillCluster}:${jdFingerprintHash}`)
  .digest('hex')
  .slice(0, 16)
```
The first 16 hex characters of a SHA-256 hash. Deterministic — same inputs always produce the same output. Not reversible — you cannot recover the user's skills or the original fingerprint from the output.

**Why this boundary exists between `applications` and `application_events`:**
The `applications` table is user-controlled, user-readable data — your Kanban board. It contains your name (via user_id FK), your email (via user), your role title, your company, your entire job-search history. It is personal data by design.

The `application_events` table is the analytics ledger. It is intended to be queryable in aggregate across all users to compute ghost rates and ATS benchmarks. If it contained `user_id`, every query result would be computable back to an individual. The strip step is the boundary that makes `application_events` aggregate-safe: no single row can be tied to a specific user even with full read access to the database.

---

## 4. Pattern Computation

**Function:** `runNightlyComputation()` in `patternComputation.service.js`.

The goal is to produce one row in `cohort_patterns` for every combination of `(skill_cluster, role_bucket, ats_platform)` that has enough data to be statistically meaningful.

**The query:**
```sql
WHERE outcome != 'pending'
  AND applied_at >= NOW() - INTERVAL '90 days'
GROUP BY skill_cluster, role_bucket, ats_platform
HAVING COUNT(*) >= 50
```

Three conditions shape the output:

**`outcome != 'pending'`** — only resolved applications count. An event sitting at `outcome = 'pending'` hasn't produced any signal yet — the user hasn't marked an outcome, so we don't know if they were ghosted, rejected, or interviewed. Including pending events would dilute rates toward zero.

**`applied_at >= NOW() - INTERVAL '90 days'`** — only events from the last 90 days. Hiring patterns change. A ghost rate computed from two-year-old data reflects a different job market than the current one. 90 days is a rolling window that keeps the pattern fresh without being too short to accumulate data.

**`HAVING COUNT(*) >= 50`** — the minimum cohort size. This is `MIN_COHORT_SIZE = 50`, hardcoded as a constant. If only 10 applications in a cohort group were ghosted, a ghost rate of 80% from that group is noise — one person's experience. At 50 or more resolved applications, the rates start to be meaningful enough to show to users. Groups with fewer than 50 events are simply dropped from the output; no pattern row is created for them and no insight card will appear.

**What gets written:**
For each group that passes the HAVING clause, `buildFinding(row)` builds a JavaScript object:
```js
{
  ghost_rate:      0.647,   // e.g. 64.7%
  rejection_rate:  0.231,
  avg_ats_score:   62.4,
  ghosted_count:   194,
  rejected_count:  69,
  interview_count: 42,
  offer_count:     10,
  cohort_size:     315,
}
```
Then `insightsDb.upsertCohortPattern()` inserts or updates the `cohort_patterns` row. The UNIQUE constraint on `(role_bucket, skill_cluster, pattern_type)` means there is always at most one row per combination. If the row already exists (every night after the first), the `DO UPDATE` clause replaces `finding`, `cohort_size`, and `computed_at` in-place. The `id` UUID stays the same — this is important because `user_insights.pattern_id` references it.

---

## 5. Insight Publishing

**Function:** `publishInsightsForPatterns(patternIds)` in `insightPublisher.service.js`.

This step takes a list of pattern UUIDs and produces personalised insight cards for specific users.

### Finding the right users

For each pattern, the `skill_cluster` string (e.g. `'javascript.react.typescript'`) is split on `.` into individual skills. `getUsersWithSkillsIn(skills)` runs a JSONB scan:

```sql
SELECT id, resume_json FROM users
WHERE resume_json IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(resume_json->'skills') s
    WHERE LOWER(s) = ANY(ARRAY[$1, $2, ...])
  )
```

This returns any user whose resume contains at least one of the pattern's skills. It is an intentionally broad sweep — a user with only JavaScript in their resume will match a pattern for `javascript.typescript.react` because they share one skill.

### The second filter (exact cluster match)

After the broad sweep, inside the per-user loop, `buildSkillCluster(user.resume_json)` recomputes the user's full cluster fingerprint:

```js
const userCluster = buildSkillCluster(user.resume_json);
if (userCluster !== pattern.skill_cluster) continue;
```

This is the exact-match gate. A user whose top 5 skills are `['JavaScript', 'Python', 'SQL', 'Docker', 'Git']` produces cluster `'docker.git.javascript.python.sql'`. They would pass the broad JSONB scan for a `javascript.typescript.react` pattern (because they have JavaScript), but then fail the exact-match check and be skipped. Insight cards are only created for users whose skill fingerprint matches exactly.

### Generating the insight text

`generateDiagnosis(pattern)` is called **once per pattern**, before the per-user loop. This is a Tier 2 model call (Groq / `llama-3.3-70b-versatile`). The same headline and action text is reused for every user who matches that pattern. The model receives only aggregate, anonymised numbers — no user data.

The function has three possible outcomes:
1. **Success** — returns `{ success: true, headline, action }`. The publisher uses these with `source = 'generated'`.
2. **not_configured** — Tier 2 env vars are missing. Falls back silently to template functions.
3. **parse_error or other_error** — model responded but the output couldn't be parsed as JSON. Falls back to template functions.

The fallback template functions are `buildHeadline(pattern)` and `buildAction(pattern)`:

```js
function buildHeadline(pattern) {
  const pct = Math.round(pattern.finding.ghost_rate * 100);
  return `${pct}% of ${pattern.skill_cluster.replace(/\./g, ', ')} ${pattern.role_bucket} applicants are ghosted — avg ATS score: ${pattern.finding.avg_ats_score}`;
}

function buildAction(pattern) {
  if (pattern.finding.ghost_rate > 0.6)     return `Consider tailoring your resume...`;
  if (pattern.finding.avg_ats_score < 40)   return `Your ATS score is likely below average...`;
  return `You are tracking well for this cohort. Keep applying...`;
}
```

### Writing the insight card

`insightsDb.createUserInsight({ userId, patternId, headline, action, source })` runs:

```sql
INSERT INTO user_insights (id, user_id, pattern_id, headline, action, source)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING
```

The `ON CONFLICT DO NOTHING` here resolves on the `UNIQUE (user_id, pattern_id)` constraint. If a card for this user + pattern combination already exists (from a previous night's run), the insert is silently skipped. Cards are not duplicated and existing `seen` state is not reset. A user who dismissed a card yesterday will not see it resurface tonight as a new card even though the pattern was refreshed.

### Push notification

After writing each insight card, `sendFcmNotification(user.id, headline)` fires a push to the FCM topic `/topics/user_<userId>`. Errors are caught and logged but never throw — a failed notification does not prevent the insight card from being written.

---

## 6. At-Least-Once Delivery

**What it means in BullMQ:** BullMQ guarantees that every job added to a queue will be processed at least once. It does not guarantee exactly once. If a worker picks up a job, starts processing it, and then the process crashes before BullMQ receives the completion acknowledgement, the job will be re-delivered to another worker instance when the system recovers.

The retry policy in `producer.js` makes this explicit:
```js
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};
```
If the first attempt fails with an exception, BullMQ waits 2 seconds and tries again. If that fails, it waits 4 seconds and tries a third time. After three failures, the job is moved to the failed set and stays there until manually retried or cleared.

**The real risk: duplicate processing.**

Consider the `application.logged` queue. A user submits an application. The jobs service publishes to `application.logged`. The intelligence worker receives the job, fetches the resume, strips PII, and calls `insertApplicationEvent`. The INSERT succeeds and the row is in `application_events`. Then, before BullMQ registers the acknowledgement, the worker process crashes.

BullMQ sees the job as unacknowledged and re-delivers it. The same `insertApplicationEvent` runs again for the same `applicationId`. Without protection:
- If `INSERT` with no conflict clause: a duplicate row with a duplicate primary key would throw a Postgres error, and the job would fail permanently.
- If `INSERT ... ON CONFLICT DO UPDATE SET outcome = 'pending', response_days = null`: the row already exists — possibly with a real outcome like `'ghosted'` set by a concurrent `updateApplicationOutcome` call — and the DO UPDATE would silently overwrite it back to pending.

**How `ON CONFLICT DO NOTHING` handles it:**

```sql
INSERT INTO application_events (...)
VALUES (...)
ON CONFLICT (application_id) DO NOTHING
```

On the first run: the row does not exist, so the INSERT proceeds normally. On any subsequent run of the same job: the row already exists, so the INSERT is silently discarded. The existing row — whatever state it's in — is left completely unchanged. No error is thrown. The job completes successfully.

This makes `insertApplicationEvent` **idempotent**: calling it multiple times with the same `applicationId` is equivalent to calling it once. Idempotency is the standard solution to at-least-once delivery.

The same protection is applied in `insightsDb.createUserInsight` — the `ON CONFLICT DO NOTHING` there means re-running the insight fan-out for the same set of pattern IDs cannot create duplicate insight cards.

---

## 7. How to Manually Trigger the Nightly Job for Testing

The scheduler fires the nightly job by adding to the `nightly-computation` queue. You can do the same manually without touching the scheduler.

**Option 1 — One-off script (run from the project root):**

```js
// scripts/trigger-nightly.js
require('dotenv').config();
const { Queue } = require('bullmq');

async function main() {
  const queue = new Queue('nightly-computation', {
    connection: { url: process.env.REDIS_URL },
  });

  const job = await queue.add('nightly-pattern-computation', {}, {
    attempts: 1,
    removeOnComplete: true,
  });

  console.log('Job added:', job.id);
  await queue.close();
}

main().catch(console.error);
```

Run it:
```bash
# From the project root, with Docker running (postgres + redis up):
node scripts/trigger-nightly.js
```

The `nightlyJobWorker` in the running intelligence service will pick it up within seconds. Watch the intelligence service logs:
```
[PatternComputation] Starting nightly run
[PatternComputation] N cohort groups found
[PatternComputation] N patterns upserted
[SkillImpact] Starting skill impact computation
[SkillImpact] N skills with >= 15 resolved applications
[InsightPublisher] Processing N patterns
[InsightPublisher] Done
```

**Option 2 — Call the pipeline functions directly (integration test style):**

If you want to skip the queue entirely and run the pipeline synchronously in a script:

```js
// Run from the intelligence service directory or configure paths
require('dotenv').config({ path: './services/intelligence/.env' });

const { runNightlyComputation }    = require('./services/intelligence/src/services/patternComputation.service');
const { computeSkillImpactPatterns } = require('./services/intelligence/src/services/skillImpact.service');
const { publishInsightsForPatterns } = require('./services/intelligence/src/services/insightPublisher.service');

async function main() {
  const patternIds = await runNightlyComputation();
  await computeSkillImpactPatterns();
  await publishInsightsForPatterns(patternIds);
  console.log('Pipeline complete. Pattern IDs:', patternIds);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

**Requirements for either approach:**
- Docker must be running with Postgres and Redis up.
- `DATABASE_URL` and `REDIS_URL` must be set (either in a `.env` file in the intelligence service directory or exported in the shell).
- For Option 1, the intelligence service container (or local process) must already be running with the workers active — the queue message has nowhere to go if no worker is listening.
- For Option 2, Postgres and Redis must be reachable, but the intelligence service itself does not need to be running.

**What to expect with a fresh database:**
If `application_events` is empty or has fewer than 50 resolved (non-pending) events, `queryCohortStats()` will return zero rows, `runNightlyComputation()` will return an empty array, and the pipeline will complete immediately with no patterns or insight cards written. Seed at least 50 resolved application_events rows (with `outcome != 'pending'` and `applied_at` within the last 90 days) to see output.
