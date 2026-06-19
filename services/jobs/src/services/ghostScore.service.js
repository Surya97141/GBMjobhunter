// ─── Ghost Score Service ──────────────────────────────────────────────────────
//
// Tier 1 — pure SQL + arithmetic. Never call modelRouter.callModel from here.
//
// computeGhostScore(jdFingerprintHash, { companyId?, companyName? })
//   → { score, label, cohortSize, reasons }
//
// score  : 0-100 (internal only — never expose the raw number in the UI)
// label  : 'low_risk' | 'moderate_risk' | 'high_risk' | 'insufficient_data'
// reasons: plain-English array explaining the contributing signals

const pool = require('../db/pool');

const MIN_COHORT = 3; // below this threshold we won't make confident ghost claims

// ─── Query 1: cohort data for this exact posting ──────────────────────────────

async function fetchCohort(jdFingerprintHash) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int                                       AS cohort_size,
      COUNT(*) FILTER (WHERE outcome = 'ghosted')::int   AS ghosted_count,
      MIN(applied_at)                                    AS first_seen,
      MIN(role_title)                                    AS role_title
    FROM applications
    WHERE jd_fingerprint_hash = $1
  `, [jdFingerprintHash]);
  return rows[0];
}

// ─── Query 2 & 3: repost count + company ghost rate ──────────────────────────
//
// role_title comparison uses case-insensitive exact match (LOWER + TRIM).
// The same posting reposted by a company will share an identical title —
// it's always copy-pasted. Fuzzy matching is intentionally avoided here:
// it would risk false positives between similar-but-distinct roles like
// "Senior Engineer" and "Software Engineer".

async function fetchCompanySignals(companyId, roleTitle) {
  const [repostResult, companyResult] = await Promise.all([
    pool.query(`
      SELECT COUNT(DISTINCT jd_fingerprint_hash)::int AS repost_count
      FROM applications
      WHERE company_id                = $1
        AND LOWER(TRIM(role_title))   = LOWER(TRIM($2))
        AND applied_at               > NOW() - INTERVAL '90 days'
    `, [companyId, roleTitle]),

    pool.query(
      'SELECT ghost_rate FROM companies WHERE id = $1',
      [companyId]
    ),
  ]);

  return {
    repostCount:      repostResult.rows[0]?.repost_count ?? 1,
    // ghost_rate is NULL for companies the intelligence service hasn't scored yet
    companyGhostRate: companyResult.rows[0]?.ghost_rate  ?? 0,
  };
}

// ─── Company identifier resolution ───────────────────────────────────────────
//
// The web app Kanban has company_id (UUID) stored on each application row.
// The extension only knows the company name extracted from the page.
// This resolver accepts either and returns the UUID (or null if unknown).

async function resolveCompanyId(companyId, companyName) {
  if (companyId) return companyId;
  if (!companyName) return null;

  const { rows } = await pool.query(
    'SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [companyName.trim()]
  );
  return rows[0]?.id ?? null;
}

// ─── Public interface ─────────────────────────────────────────────────────────

async function computeGhostScore(jdFingerprintHash, { companyId, companyName } = {}) {
  const cohort     = await fetchCohort(jdFingerprintHash);
  const cohortSize = cohort.cohort_size;

  if (cohortSize < MIN_COHORT) {
    return {
      score:     null,
      label:     'insufficient_data',
      cohortSize,
      reasons:   ['Not enough applicants to this posting yet'],
    };
  }

  const ghostedFraction = cohort.ghosted_count / cohortSize;
  const daysLive = cohort.first_seen
    ? Math.floor((Date.now() - new Date(cohort.first_seen).getTime()) / 86_400_000)
    : 0;

  const resolvedId = await resolveCompanyId(companyId, companyName);

  let repostCount      = 1;
  let companyGhostRate = 0;

  if (resolvedId && cohort.role_title) {
    const signals    = await fetchCompanySignals(resolvedId, cohort.role_title);
    repostCount      = signals.repostCount;
    companyGhostRate = signals.companyGhostRate ?? 0;
  }

  // ── Weighted scoring formula ─────────────────────────────────────────────
  // All inputs normalised to 0-1 before weights are applied.
  // Weights: ghost fraction (50) + posting age (25) + repost frequency (15)
  //        + company base rate (10) = 100 max.
  const rawScore =
    (ghostedFraction             * 50) +
    (Math.min(daysLive / 90, 1)  * 25) +
    (Math.min(repostCount / 3, 1) * 15) +
    (companyGhostRate             * 10);

  const score = Math.round(Math.min(Math.max(rawScore, 0), 100));

  const label = score >= 65 ? 'high_risk'
              : score >= 35 ? 'moderate_risk'
              :               'low_risk';

  // ── Reasons — only include a signal if it meaningfully contributed ────────
  const reasons = [];

  if (ghostedFraction > 0.5) {
    reasons.push(
      `${cohort.ghosted_count} of ${cohortSize} cohort applicants were ghosted`
    );
  }
  if (daysLive > 45) {
    reasons.push(`This posting has been live ${daysLive} days`);
  }
  if (repostCount > 1) {
    reasons.push(`Reposted ${repostCount} times in the last 90 days`);
  }
  if (companyGhostRate > 0.4) {
    reasons.push(
      `This company has a ${Math.round(companyGhostRate * 100)}% ghost rate historically`
    );
  }

  if (reasons.length === 0) {
    reasons.push('No red flags detected for this posting.');
  }

  return { score, label, cohortSize, reasons };
}

module.exports = { computeGhostScore };
