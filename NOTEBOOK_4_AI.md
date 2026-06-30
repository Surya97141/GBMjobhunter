# Notebook 4 — AI Features: Tiers, Routing, Scoring, and Generation

---

## 1. The Three Tiers

The platform uses a three-tier model architecture. The tiers are not defined by cost alone — they are defined by where computation happens and what kind of task they are appropriate for.

---

### Tier 1 — No model call

**Provider:** None. Runs client-side in the browser or via direct SQL query in the backend.

**Model:** None.

**Tasks:** TF-IDF resume scoring (see Section 4), ghost score computation (Section 4), cohort DB lookup. Any task that can be answered with deterministic arithmetic or a database query belongs here.

**Cost/speed:** Zero API cost. Runs in milliseconds inside the service or the browser. No network round-trip to an AI provider.

**Quota/rate limits:** None for model calls. Subject to the gateway's standard 100 req/min rate limit like any other route.

**Critical rule:** Calling `callModel('tier1', ...)` throws an error immediately:
```
Tier 1 tasks run client-side or via direct DB query — do not route through callModel.
```
This is intentional — Tier 1 is defined as "not a model call", and the throw catches the mistake early rather than silently doing something wrong.

---

### Tier 2 — Fast open-source model (Groq)

**Provider:** Any OpenAI-compatible endpoint. Currently configured for Groq via `TIER2_API_BASE = https://api.groq.com/openai/v1`.

**Model:** Configured via `TIER2_MODEL_NAME`. Currently `llama-3.3-70b-versatile`.

**Tasks:**
- Cover letter generation (`/agent/generate-cover-letter`)
- Hiring process explanations (`/agent/explain-hiring-process`)
- Nightly diagnostic generation (called from `diagnosticGenerator.service.js` with pattern data)

**Cost/speed:** Groq runs on dedicated LPU hardware and is very fast — typically sub-second for 300–700 token responses. Cost is per token but low relative to frontier models.

**Quota/rate limits:** No per-user quota enforced by this codebase. Tier 2 is considered cheap enough that the gateway's 100 req/min rate limit is the only constraint.

**Configuration:** Three env vars must all be present for Tier 2 to function. If any is missing, `callModel('tier2', ...)` returns a structured `not_configured` error immediately — it does not crash.

---

### Tier 3 — Frontier model (Anthropic Claude)

**Provider:** Anthropic, via the `@anthropic-ai/sdk` npm package. Uses the official SDK, not a raw HTTP call.

**Model:** Configured via `TIER3_MODEL`. Defaults to `'claude-sonnet-4-6'` in code if the env var is not set. The `.env.production` template sets it to `claude-haiku-4-5-20251001`.

**Tasks:**
- Outreach message drafting (`/agent/generate-outreach`) — uses company signals and user skills for personalisation

**Cost/speed:** More expensive per token than Tier 2. Used only for tasks where the quality difference is significant — personalised outreach where tone, nuance, and factual grounding matter more than throughput.

**Quota/rate limits:** Per-user daily quota enforced in Redis. The quota value comes from `TIER3_QUOTA_PER_DAY` env var; code default is `5`. The `.env.production` template sets it to `50`. See Section 3 for the exact Redis implementation.

**Configuration:** Only `TIER3_API_KEY` is strictly required. `TIER3_MODEL` falls back to a code default. Missing `TIER3_API_KEY` returns a `not_configured` error.

---

## 2. The Agent Endpoints and How Model Calls Work

There is **no generic `/agent/call` endpoint**. The agent service exposes four specific endpoints, each named for its task. Routing decisions — which tier to call — are hardcoded inside each endpoint handler. Here is how each one works.

---

### `GET /agent/health`

Returns the current tier configuration status:

```json
{
  "status": "ok",
  "tiers": {
    "tier1": { "status": "always_available", "note": "..." },
    "tier2": { "status": "configured", "model": "llama-3.3-70b-versatile" },
    "tier3": { "status": "not_configured", "model": "claude-haiku-4-5-20251001", "missing": ["TIER3_API_KEY"] }
  },
  "quota": { "tier3_per_day": 50 }
}
```

No model call is made. This is a quick way to verify what's configured without triggering any AI usage.

---

### `POST /agent/generate-cover-letter` — Tier 2

**Request body:**
```json
{
  "role":            "Senior Frontend Engineer",
  "company":         "Stripe",
  "jobDescription":  "optional — up to 3000 characters are used"
}
```
`role` and `company` are required. `jobDescription` is optional — if omitted, the model writes without JD-specific details.

**How it calls the model:**
```js
callModel('tier2', 'cover_letter_generate', {
  systemPrompt: '...three-paragraph format, no placeholders, max 250 words...',
  messages:     [{ role: 'user', content: userContent }],
  maxTokens:    600,
  temperature:  0.7,
})
```

**Response shape (success):**
```json
{
  "success": true,
  "data": {
    "choices": [{
      "message": {
        "content": "Dear Hiring Manager,\n\nParagraph one..."
      }
    }],
    "usage": { "prompt_tokens": 284, "completion_tokens": 218 }
  }
}
```
The caller receives the raw OpenAI-compatible response. The cover letter text is at `result.data.choices[0].message.content`.

**Response shape (error):**
```json
{ "success": false, "error": "not_configured", "message": "Tier 2 is not configured..." }
{ "success": false, "error": "timeout",         "message": "Tier 2 call timed out after 10000ms..." }
{ "success": false, "error": "provider_error",  "message": "Provider returned HTTP 429" }
```
All error shapes have `success: false`, a machine-readable `error` string, and a human-readable `message`. The endpoint passes the `callModel` result through unchanged — it does not wrap or reformat errors.

---

### `POST /agent/generate-outreach` — Tier 3

**Request body:**
```json
{
  "companyName":  "Stripe",
  "roleTitle":    "Senior Frontend Engineer",
  "jdText":       "optional — up to 1500 characters",
  "contactName":  "optional",
  "contactRole":  "optional"
}
```
`companyName` and `roleTitle` are required. The `x-user-id` header must be present (injected by the gateway after JWT verification).

**What it does before calling the model:**
1. Looks up company signals: `getCompanySignals(companyName)` — returns `ghost_rate`, `avg_response_days`, `size_band` from the `companies` table.
2. Looks up user skills: `getUserSkills(userId)` — returns the skills array from `resume_json`.
3. Both lookups are non-fatal: if either fails, it continues without that context.
4. Assembles cohort context from signals (ghost rate %, avg response days, size band) and passes it to the model as tone calibration only — the system prompt explicitly instructs the model never to mention these statistics in the output.

**How it calls the model:**
```js
callModel('tier3', 'outreach_draft', {
  userId,        // required — triggers quota check
  systemPrompt:  OUTREACH_SYSTEM_PROMPT,
  messages:      [{ role: 'user', content: lines.join('\n') }],
  maxTokens:     300,
  temperature:   0.7,
})
```

**Response shape (success):**
```json
{
  "success": true,
  "data": {
    "content": [{ "type": "text", "text": "Hi Sarah,\n\nI came across..." }],
    "usage": { "input_tokens": 347, "output_tokens": 112 }
  }
}
```
Tier 3 uses the Anthropic SDK response format, which is different from Tier 2. The text is at `result.data.content[0].text`.

**Response shape (quota exceeded):**
```json
{
  "success": false,
  "error":   "quota_exceeded",
  "message": "Daily Tier 3 quota of 50 calls reached for this user. Resets at midnight UTC."
}
```

---

### `POST /agent/explain-hiring-process` — Tier 2

**Request body:**
```json
{
  "topic": "behavioral round"
}
```
`topic` must be exactly one of five allowed strings. The handler validates against a `Set`:
```js
const CURRICULUM_TOPICS = new Set([
  'behavioral round',
  'recruiter first-30-seconds screen',
  'talking about a project',
  'what culture fit means',
  'following up after an interview',
]);
```
Any other value returns `400 { status: 'error', message: 'topic is required and must be one of: ...' }`.

The handler fetches the user's skills (`getUserSkills(userId)`) and uses one of those skills as the concrete example required by the "Barrier 2" pedagogical principle in the system prompt. If the user has no resume, a generic skill example is substituted.

---

## 3. Tier 3 Quota Enforcement

**Redis data structure:** A single string key per user per day, holding an integer counter.

**Key format:**
```
tier3_quota:<userId>:<YYYY-MM-DD>
```

For example, user `f1a2b3c4-...` on 2025-01-15:
```
tier3_quota:f1a2b3c4-uuid-here:2025-01-15
```

**How counting works:**

`checkTier3Quota(userId)` in `rateLimiter.service.js` does two things:

1. `await redis.incr(key)` — atomically increments the counter and returns the new value. If the key doesn't exist yet, Redis creates it at 0 and immediately increments to 1.

2. If the returned count is exactly 1 (meaning this is the first call today), it calls `await redis.expire(key, secondsUntilMidnightUTC())`. This sets a TTL so Redis automatically deletes the key at midnight UTC without any cleanup job.

3. If `count > QUOTA_PER_DAY`, return `{ allowed: false, remainingToday: 0 }`.

4. Otherwise return `{ allowed: true, remainingToday: QUOTA_PER_DAY - count }`.

**When the counter resets:** At midnight UTC. `todayUTC()` returns `new Date().toISOString().split('T')[0]` — for example `'2025-01-15'`. At 00:00:00 UTC, the date string changes to `'2025-01-16'`, so the next call uses a new key. The old key has a TTL set to expire at exactly that moment, so Redis cleans it up automatically.

**Important: the increment happens before the check.** The INCR runs unconditionally. If a user is at count 49 (one under quota) and sends two simultaneous requests, both INCRs run, the counts become 50 and 51. The count=50 request sees `50 > 50` is false and is allowed. The count=51 request sees `51 > 50` is true and is rejected. This is correct atomic behaviour — Redis INCR is single-threaded.

**Where quota is checked in the call chain:**
```
POST /agent/generate-outreach
  → callModel('tier3', 'outreach_draft', { userId, ... })
    → callTier3(task, payload)
      → checkTier3Quota(userId)   ← happens here, before any API call
        if !quota.allowed → return { success: false, error: 'quota_exceeded', ... }
      → new Anthropic({ apiKey, timeout })
      → client.messages.create(...)
```

The quota check runs before the API key check and before any Anthropic SDK call. This means quota is tracked even if `TIER3_API_KEY` is not set — a consistent count even in misconfigured environments.

**What to set `QUOTA_PER_DAY` to:**
The code default in `rateLimiter.service.js` is `5`. The `.env.production` template sets `TIER3_QUOTA_PER_DAY=50`. Set it to whatever you want in the `.env` file on the VPS; the agent service reads it at boot. Change requires a container restart.

---

## 4. Ghost Score Computation

Ghost score answers a different question from ATS score. Ghost score estimates the probability that a job posting will never respond to applicants (a ghost job). ATS score estimates how well a specific resume matches a job description. These are computed by different services using different techniques.

### ATS Score — TF-IDF similarity (`scoreResumeAgainstJD` in `tfidf.js`)

**What TF-IDF means in plain English:**

TF stands for Term Frequency. The idea is that if a word appears many times in a job description, it is more important to that description than a word that appears once. If the JD says "TypeScript" eight times and "Python" once, TypeScript matters more to the match.

IDF stands for Inverse Document Frequency — a correction that down-weights words that appear in nearly every document (so "engineer" in a JD is less distinctive than "Kubernetes"). This codebase implements only the TF half — it weights by frequency within the single JD, but does not compare across a corpus. The function name references TF-IDF conceptually, but the implementation is frequency-weighted keyword matching.

**How it works:**

1. `flattenResume(resumeJson)` extracts text from skills, work experience roles/descriptions, and education. Joins it all into one string.
2. `tokenize(text)` lowercases, strips non-alphanumeric characters (preserving `+`, `#`, `.`), splits on whitespace, removes single-character tokens and stop words. Stop words include both common English words and job-listing filler words (`'experience'`, `'team'`, `'role'`, `'opportunity'`, `'excellent'`, etc.).
3. The resume tokens are stored in a `Set` for O(1) lookup.
4. The JD text goes through the same `tokenize`, then `termFrequencies` counts how many times each token appears.
5. `totalWeight` = sum of all JD token frequencies (total meaningful word count).
6. `matchedWeight` = sum of frequencies for JD tokens that also appear in the resume.
7. Score = `Math.round((matchedWeight / totalWeight) * 100)` — a number from 0 to 100 representing what fraction of the JD's token weight is covered by the resume.

**What the score means:** A score of 72 means the resume covers words that account for 72% of the weighted word count in the job description. It is not a semantic similarity score — it does not understand meaning, synonyms, or context. It is a keyword coverage metric.

**How it's used:** Stored in `applications.ats_score_at_apply` at the time a user submits an application. Also returned in real time when the user calls `POST /applications/score` before submitting. The score is also cached in `users.ats_score_cache` for quick display on the dashboard without recomputing.

---

### Ghost Score (`computeGhostScore` in `ghostScore.service.js`)

Ghost score is Tier 1 — pure SQL and arithmetic, no model call. It answers: "How likely is it that this posting will ghost applicants?"

**Inputs:**
- `jdFingerprintHash` — SHA-256 of the JD text (first 16 hex chars). Identifies the specific posting. Generated by `fingerprintJD()` in `fingerprint.js`.
- `companyId` (UUID, optional) or `companyName` (string, optional). If only a name is supplied, the function looks up the UUID.

**The fingerprint:** `hashJD(jdText)` in `fingerprint.js` lowercases and trims the JD text, then takes the first 16 hex chars of its SHA-256. The same JD text always produces the same hash. If a company reposts the same job, the hash matches, which is how the "repost count" signal is detected.

**Query 1 — Cohort for this exact posting:**
```sql
SELECT
  COUNT(*)::int AS cohort_size,
  COUNT(*) FILTER (WHERE outcome = 'ghosted')::int AS ghosted_count,
  MIN(applied_at) AS first_seen,
  MIN(role_title) AS role_title
FROM applications
WHERE jd_fingerprint_hash = $1
```
Finds all applications from all users who applied to this exact job description.

**Minimum threshold:** If `cohort_size < 3` (the `MIN_COHORT` constant), the function returns immediately with:
```js
{ score: null, label: 'insufficient_data', cohortSize, reasons: ['Not enough applicants...'] }
```

**Query 2 — Repost count (parallel with Query 3):**
```sql
SELECT COUNT(DISTINCT jd_fingerprint_hash)::int AS repost_count
FROM applications
WHERE company_id = $1
  AND LOWER(TRIM(role_title)) = LOWER(TRIM($2))
  AND applied_at > NOW() - INTERVAL '90 days'
```
Counts how many distinct JD fingerprints exist for the same company and same role title in the last 90 days. A count > 1 means the company posted slightly different versions of the same listing — often a signal of a role that's hard to fill or is being churned.

**Query 3 — Company's historical ghost rate (parallel with Query 2):**
```sql
SELECT ghost_rate FROM companies WHERE id = $1
```
`ghost_rate` is a `FLOAT` column populated by an external process. It represents the company's baseline rate of ghosting applicants across all roles, not just this one.

**Weighted scoring formula:**
```
rawScore = (ghostedFraction * 50)
         + (Math.min(daysLive / 90, 1) * 25)
         + (Math.min(repostCount / 3, 1) * 15)
         + (companyGhostRate * 10)
```

The four signals and their maximum contributions:
- **Ghost fraction for this posting** (50 points max): If every applicant in the cohort was ghosted, this contributes 50. If none were ghosted, it contributes 0.
- **Posting age** (25 points max): Capped at 90 days. A posting that's been up 45 days contributes 12.5. After 90 days, it maxes out at 25.
- **Repost count** (15 points max): Capped at 3 reposts. One repost contributes 5, two contributes 10, three or more contributes 15.
- **Company base rate** (10 points max): If the company has a 100% historical ghost rate, this adds 10.

**Label thresholds:**
- score >= 65 → `'high_risk'`
- score >= 35 → `'moderate_risk'`
- score < 35 → `'low_risk'`

**Reasons array:** Only signals that "meaningfully contributed" generate a reason:
- ghostedFraction > 0.5 → explains the cohort ghost count
- daysLive > 45 → explains the posting age
- repostCount > 1 → explains the repost count
- companyGhostRate > 0.4 → explains the company rate

The comment in the source notes: `score: 0-100 (internal only — never expose the raw number in the UI)`. The label is what should be shown to users; the score is an implementation detail.

---

## 5. Diagnostic and Insight Generation

There are two separate services involved in generating insight card text:

### `diagnosticGenerator.service.js` — Tier 2 model call, runs once per pattern

`generateDiagnosis(pattern)` takes a single `cohort_patterns` row as input. It calls Tier 2 (Groq / llama-3.3-70b-versatile) with only anonymised aggregate numbers — no user data reaches the model.

**What it sends to the model:**
```
Pattern data: ghost rate 65%, rejection rate 23%, average ATS score 58,
cohort size 315 applicants, role bucket "software.engineer",
skill cluster "javascript.typescript.react".
```

**What it asks the model for:**
Two fields in JSON: `headline` (one sentence stating the finding) and `action` (2–3 sentences explaining what to do). The system prompt instructs: use only numbers that were provided, never invent statistics, state discouraging signals honestly, no placeholder brackets.

**Parsing the response:**
The model's raw output goes through `extractFields(raw)`. It first strips any markdown code fences (some models wrap JSON in ` ```json ``` ` even when not asked). Then it tries `JSON.parse`. If that fails, it runs a regex fallback that finds the `"action":` boundary, works backwards to extract the headline, and strips trailing punctuation. If both attempts fail, `extractFields` returns `null` and `generateDiagnosis` returns `{ success: false, reason: 'parse_error' }`.

**Return shapes:**
```js
// Success:
{ success: true, headline: '65% of...', action: 'Consider...', source: 'generated' }

// Model not configured:
{ success: false, reason: 'not_configured' }

// Model responded but output couldn't be parsed:
{ success: false, reason: 'parse_error' }

// Any other failure (timeout, provider error):
{ success: false, reason: 'other_error' }
```

**Cross-service require (architectural note):**
`diagnosticGenerator.service.js` contains this line:
```js
const { callModel } = require('../../../agent/src/services/modelRouter.service');
```
The intelligence service directly requires a file from the agent service's source directory. The comment in the file explicitly flags this as a "hard filesystem coupling" that would break if the two services were deployed separately. This works only because both services run from the same monorepo directory on the same machine. The "[Agent] Connected to Redis" log line you'll see in intelligence-service output is a side-effect from the agent's redis client being opened by this import.

---

### `insightPublisher.service.js` — orchestrates generation and fan-out

`publishInsightsForPatterns(patternIds)` calls `generateDiagnosis` once per pattern, then creates one `user_insights` row per matching user.

**The fallback template functions:**

If `generateDiagnosis` fails for any reason, these functions produce deterministic text from the pattern data:

```js
function buildHeadline(pattern) {
  const pct = Math.round(pattern.finding.ghost_rate * 100);
  return `${pct}% of ${pattern.skill_cluster.replace(/\./g, ', ')} ${pattern.role_bucket} applicants are ghosted — avg ATS score: ${pattern.finding.avg_ats_score}`;
}

function buildAction(pattern) {
  if (pattern.finding.ghost_rate > 0.6) {
    return `Consider tailoring your resume keywords more closely to the JD. The average ATS score for successful candidates in this cohort is ${pattern.finding.avg_ats_score}.`;
  }
  if (pattern.finding.avg_ats_score < 40) {
    return `Your ATS score is likely below average for this role type. Add more role-specific keywords from the job description.`;
  }
  return `You are tracking well for this cohort. Keep applying and following up after 7 days.`;
}
```

**The `source` field:**

The `user_insights.source` column records how the text was produced:
- `'generated'` — `generateDiagnosis` succeeded and the text came from the Tier 2 model.
- `'templated'` — `generateDiagnosis` failed (any reason) and the text came from `buildHeadline` + `buildAction`. This is also the default for any row created before migration 011 added the column.

This distinction exists so that future analytics can track model reliability — you can query `WHERE source = 'templated'` to count how often the AI generation failed and the template ran as fallback.

**What the `headline` and `action` fields contain:**

`headline` is a one-sentence finding: the ghost rate percentage, the skill cluster and role bucket of the cohort, and the average ATS score. It is a factual statement of what the data shows.

`action` is 1–3 sentences of advice. With templates, it follows three branches (high ghost rate → resume keywords, low ATS score → add keywords, otherwise → tracking well). With AI generation, the model writes its own action within the constraints of the system prompt.

Both fields are written once at insight creation time and not updated when the underlying pattern is refreshed. If the nightly job runs and updates the pattern's finding, the `user_insights` row with `ON CONFLICT DO NOTHING` is left unchanged — existing card text does not get overwritten.

---

## 6. How to Add a New AI Feature

Here is the complete sequence for adding a new endpoint to the agent service.

**Step 1 — Decide the tier.**
If the task is keyword matching, classification, or anything answerable by SQL: it's Tier 1, do not touch `callModel`. If the task is text generation, summarisation, or extraction that needs a model but doesn't require Claude-level quality: Tier 2. If it needs nuance, tone, or frontier-model reasoning and is user-facing (not a background job): Tier 3.

**Step 2 — Add the route in `services/agent/index.js`.**
All routes are mounted under `/agent` and then connected with `app.use('/agent', router)`. Add your route to the `router`:

```js
router.post('/my-new-feature', async (req, res) => {
  // 1. Extract userId from the header injected by the gateway
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'x-user-id header required' });
  }

  // 2. Validate required body fields
  const { inputField } = req.body ?? {};
  if (!inputField) {
    return res.status(400).json({ status: 'error', message: 'inputField is required' });
  }

  // 3. Optional DB lookups for context (non-fatal — catch and continue)
  let extraContext = null;
  try {
    extraContext = await getSomeContext(userId);
  } catch (err) {
    console.error('[MyFeature] Context lookup failed:', err.message);
  }

  try {
    const result = await callModel('tier2', 'my_feature_task', {
      systemPrompt: 'Your system prompt here.',
      messages: [{ role: 'user', content: `Input: ${inputField}` }],
      maxTokens: 400,
      temperature: 0.5,
      // For Tier 3, also pass userId:
      // userId,
    });

    // Pass through unchanged — callers handle success and error shapes consistently.
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'internal_error', message: err.message });
  }
});
```

**Step 3 — Handle the response in the caller.**

The response is always `{ success: boolean, ... }`. Never assume success without checking:

```js
const result = await callModel('tier2', 'my_task', payload);

if (!result.success) {
  // Possible error strings: 'not_configured', 'timeout', 'provider_error',
  // 'network_error', 'quota_exceeded'
  console.error('Model call failed:', result.error, result.message);
  return fallbackBehaviour();
}

// Extract text from the raw provider response:
// Tier 2 (OpenAI-compatible):
const text = result.data.choices[0].message.content;

// Tier 3 (Anthropic):
const text = result.data.content[0].text;
```

**Step 4 — Watch out for these four things.**

**Timeout:** The default timeout is `process.env.MODEL_TIMEOUT_MS || 10_000` (10 seconds). A timeout returns `{ success: false, error: 'timeout', message: '...' }` — not a thrown exception. Your handler receives this as a normal return value. Do not set `maxTokens` higher than needed — large outputs mean longer waits.

**Quota (Tier 3 only):** Always pass `userId` in the payload when using Tier 3. Without it, `checkTier3Quota` is skipped and no quota is enforced or counted. Pass `userId` even if your endpoint doesn't require personalisation.

**Error format consistency:** Pass `callModel` results through to the HTTP response unchanged where possible. The `not_configured` error shape is a deliberate design — the frontend can detect it and show a "feature not available" state instead of a generic error. If you wrap the error in a different format, you break that contract.

**Tier 2 vs Tier 3 response shape:** The raw data object is structured differently:
- Tier 2: `result.data.choices[0].message.content` — OpenAI chat completions format
- Tier 3: `result.data.content[0].text` — Anthropic messages format

If you add a route that can call either tier based on configuration, you need to handle both shapes.

---

## 7. Model Strings

**Tier 2 model string:**

Configured by the `TIER2_MODEL_NAME` environment variable. Current value: `llama-3.3-70b-versatile`.

This string is passed directly to the provider's API as the `model` field. It must match exactly what the provider expects — Groq's model names are listed in their API documentation.

Where it's used: inside `callTier2` in `modelRouter.service.js`:
```js
const model = process.env.TIER2_MODEL_NAME;
```

**Tier 3 model string:**

Configured by the `TIER3_MODEL` environment variable. Code default (if env var is absent): `'claude-sonnet-4-6'`. The `.env.production` template sets it to `claude-haiku-4-5-20251001`.

Where it's used: inside `callTier3` in `modelRouter.service.js`:
```js
const model = process.env.TIER3_MODEL || 'claude-sonnet-4-6';
```

**How to swap to a different model:**

For Tier 2 — change `TIER2_MODEL_NAME` in `.env` (or on the VPS: edit `.env`, then `docker compose up -d agent-service`). If you also want to switch providers (e.g. from Groq to Together AI), change `TIER2_API_BASE` and `TIER2_API_KEY` as well. No code change is needed as long as the new provider is OpenAI-compatible (responds to `POST /chat/completions` with the same schema).

For Tier 3 — change `TIER3_MODEL` in `.env`. Anthropic model IDs follow the pattern `claude-<family>-<version>-<date>`. You can swap from Haiku to Sonnet or Opus by changing the env var. More capable models cost more per token and may be slower.

**To verify which model is active without restarting anything:**

Call `GET /agent/health` (through the gateway: `GET /api/agent/health`). The response includes:
```json
"tier2": { "status": "configured", "model": "llama-3.3-70b-versatile" },
"tier3": { "status": "configured", "model": "claude-haiku-4-5-20251001" }
```
The `model` field shows the actual value of the env var at the time the service started.
