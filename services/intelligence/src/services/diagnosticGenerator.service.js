// ─── Rejection Diagnostician — Tier 2 generator ──────────────────────────────
//
// Called once per COHORT_PATTERN before the per-user fan-out loop in
// insightPublisher. Returns a generated headline + action, or a failure shape
// that the publisher uses to fall back to the existing hardcoded templates.
//
// Only aggregate, anonymised pattern numbers reach the model — no user-
// identifying data, consistent with the anonymisation principle applied
// throughout the rejection intelligence engine.
//
// Cross-service require: modelRouter lives in the agent service. Importing via
// relative path is the simplest option that avoids duplicating the tier-routing
// logic in the monorepo. Side-effect: agent/src/utils/redis.js opens a second
// Redis client in this process (same REDIS_URL). Redis handles multiple clients
// without issue; the "[Agent] Connected to Redis" log line in intelligence-service
// output is cosmetic noise from that import chain.
//
// ARCHITECTURAL NOTE: this require creates a hard filesystem coupling between
// two otherwise-independent services (each has its own package.json and its own
// deployability). This is fine while both run from one monorepo on one machine,
// but breaks if they are ever deployed separately (separate containers, separate
// repos). Future fix: extract modelRouter into a shared internal package, or
// have intelligence call the agent service over HTTP through the gateway, which
// is how every other cross-service interaction in this codebase works.

const { callModel } = require('../../../agent/src/services/modelRouter.service');

const SYSTEM_PROMPT =
  'You are explaining a real statistical pattern from job application outcome data ' +
  'to a job seeker. You will be given exact numbers — use only those numbers, never ' +
  'invent or estimate a number that was not provided. If the pattern shows a negative ' +
  'or discouraging signal, state it honestly and plainly — do not soften it into false ' +
  'encouragement. Write two parts: a one-sentence headline stating the finding, and a ' +
  '2-3 sentence action explaining what it means and what to do about it. Be specific ' +
  'to the actual numbers given, not generic career advice. No placeholder brackets in ' +
  'output. Output as JSON with exactly these two fields: { "headline": string, "action": string }.';

function buildUserMessage(pattern) {
  const f   = pattern.finding;
  const pct = n => Math.round(Number(n) * 100);

  return (
    `Pattern data: ` +
    `ghost rate ${pct(f.ghost_rate)}%, ` +
    `rejection rate ${pct(f.rejection_rate)}%, ` +
    `average ATS score ${f.avg_ats_score}, ` +
    `cohort size ${f.cohort_size} applicants, ` +
    `role bucket "${pattern.role_bucket}", ` +
    `skill cluster "${pattern.skill_cluster}".`
  );
}

// Extract headline and action from model output.
// Handles both properly-quoted JSON and the common model failure mode where
// string values are emitted without wrapping quotes:
//   { "headline": 75% of applicants..., "action": Consider... }
// Strategy: try JSON.parse first; on failure, split on "action": and extract
// each value by stripping trailing punctuation/braces rather than relying on
// the model to quote its own strings.
function extractFields(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed   = JSON.parse(cleaned);
    const headline = String(parsed?.headline ?? '').trim();
    const action   = String(parsed?.action   ?? '').trim();
    if (headline && action) return { headline, action };
  } catch {}

  // Fallback: find where "action": starts, then work backwards/forwards.
  const actionStart = cleaned.search(/"action"\s*:/);
  if (actionStart < 0) return null;

  const headlineRaw = (cleaned.slice(0, actionStart).match(/"headline"\s*:\s*([\s\S]+)/)?.[1] ?? '');
  const headline    = headlineRaw.replace(/^"/, '').replace(/[",\s]+$/, '').trim();

  const actionRaw = (cleaned.slice(actionStart).match(/"action"\s*:\s*([\s\S]+)/)?.[1] ?? '');
  const action    = actionRaw.replace(/^"/, '').replace(/["\s}]+$/, '').trim();

  return (headline && action) ? { headline, action } : null;
}

async function generateDiagnosis(pattern) {
  let result;
  try {
    result = await callModel('tier2', 'diagnosis_explain', {
      systemPrompt: SYSTEM_PROMPT,
      messages:     [{ role: 'user', content: buildUserMessage(pattern) }],
      maxTokens:    300,
      temperature:  0.4,
    });
  } catch (err) {
    console.error('[DiagnosticGenerator] callModel threw unexpectedly:', err.message);
    return { success: false, reason: 'other_error' };
  }

  if (!result.success) {
    const reason = result.error === 'not_configured' ? 'not_configured' : 'other_error';
    if (reason !== 'not_configured') {
      console.error('[DiagnosticGenerator] callModel failed:', result.error, result.message);
    }
    return { success: false, reason };
  }

  const raw    = result.data?.choices?.[0]?.message?.content ?? '';
  const fields = extractFields(raw);

  if (!fields) {
    console.error('[DiagnosticGenerator] parse failed — raw output:', raw.slice(0, 200));
    return { success: false, reason: 'parse_error' };
  }

  return { success: true, headline: fields.headline, action: fields.action, source: 'generated' };
}

module.exports = { generateDiagnosis };
