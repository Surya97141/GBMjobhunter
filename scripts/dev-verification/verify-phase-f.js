'use strict';
// Phase F Step 4 — Rejection Diagnostician verification
// Run from project root: node verify-phase-f.js

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../services/intelligence/.env') });

// ─── Test patterns — three genuinely different finding shapes ─────────────────
// Pattern A: ghost_rate > 0.6  → buildAction branch 1 (mentions avg ATS score)
// Pattern B: avg_ats_score < 40 → buildAction branch 2 (add keywords)
// Pattern C: else              → buildAction branch 3 (tracking well)

const PATTERNS = [
  {
    roleBucket:   'test_highghost',
    skillCluster: 'javascript.typescript',
    patternType:  'outcome_distribution',
    cohortSize:   50,
    finding: {
      ghost_rate:      0.75,
      rejection_rate:  0.15,
      avg_ats_score:   58,
      ghosted_count:   37,
      rejected_count:  7,
      interview_count: 4,
      offer_count:     2,
      cohort_size:     50,
    },
    expectedHeadline: '75% of javascript, typescript test_highghost applicants are ghosted — avg ATS score: 58',
    expectedAction:   'Consider tailoring your resume keywords more closely to the JD. The average ATS score for successful candidates in this cohort is 58.',
  },
  {
    roleBucket:   'test_lowats',
    skillCluster: 'javascript.typescript',
    patternType:  'outcome_distribution',
    cohortSize:   50,
    finding: {
      ghost_rate:      0.30,
      rejection_rate:  0.40,
      avg_ats_score:   35,
      ghosted_count:   15,
      rejected_count:  20,
      interview_count: 10,
      offer_count:     5,
      cohort_size:     50,
    },
    expectedHeadline: '30% of javascript, typescript test_lowats applicants are ghosted — avg ATS score: 35',
    expectedAction:   'Your ATS score is likely below average for this role type. Add more role-specific keywords from the job description.',
  },
  {
    roleBucket:   'test_tracking',
    skillCluster: 'javascript.typescript',
    patternType:  'outcome_distribution',
    cohortSize:   50,
    finding: {
      ghost_rate:      0.20,
      rejection_rate:  0.30,
      avg_ats_score:   72.5,
      ghosted_count:   10,
      rejected_count:  15,
      interview_count: 20,
      offer_count:     5,
      cohort_size:     50,
    },
    expectedHeadline: '20% of javascript, typescript test_tracking applicants are ghosted — avg ATS score: 72.5',
    expectedAction:   'You are tracking well for this cohort. Keep applying and following up after 7 days.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function p(pass, label)  { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg)       { console.log(`     ${msg}`); }

// ─── Temp counter injection ───────────────────────────────────────────────────

const DIAG_PATH    = path.resolve(__dirname, '../../services/intelligence/src/services/diagnosticGenerator.service.js');
const COUNTER_MARK = 'PHASE_F_COUNTER';
const NEEDLE       = 'async function generateDiagnosis(pattern) {\n';
const COUNTER_LINE = `  console.log('[DiagnosticGenerator] ${COUNTER_MARK} called for pattern:', pattern.id);\n`;

function addTempCounter() {
  let src = fs.readFileSync(DIAG_PATH, 'utf8');
  if (src.includes(COUNTER_MARK)) return;
  src = src.replace(NEEDLE, NEEDLE + COUNTER_LINE);
  fs.writeFileSync(DIAG_PATH, src, 'utf8');
}

function removeTempCounter() {
  let src = fs.readFileSync(DIAG_PATH, 'utf8');
  src = src.replace(COUNTER_LINE, '');
  fs.writeFileSync(DIAG_PATH, src, 'utf8');
}

function clearServiceCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('diagnosticGenerator') || k.includes('insightPublisher')) {
      delete require.cache[k];
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══ Phase F Step 4 — Rejection Diagnostician Verification ═══\n');

  const pool       = require(path.resolve(__dirname, '../../services/intelligence/src/db/pool'));
  const insightsDb = require(path.resolve(__dirname, '../../services/intelligence/src/db/insights.db'));

  // ── Seed test patterns ────────────────────────────────────────────────────
  const patternIds = [];
  for (const tp of PATTERNS) {
    const id = await insightsDb.upsertCohortPattern({
      roleBucket:   tp.roleBucket,
      skillCluster: tp.skillCluster,
      patternType:  tp.patternType,
      finding:      tp.finding,
      cohortSize:   tp.cohortSize,
    });
    patternIds.push(id);
    note(`Seeded ${tp.roleBucket} → ${id}`);
  }

  // Informational: how many users will match this cluster
  const { rows: cntRows } = await pool.query(`
    SELECT COUNT(DISTINCT id) AS cnt FROM users
    WHERE resume_json IS NOT NULL
      AND resume_json -> 'skills' @> '["javascript"]'::jsonb
      AND resume_json -> 'skills' @> '["typescript"]'::jsonb
  `);
  const matchedUserCount = parseInt(cntRows[0].cnt, 10);
  note(`Users with javascript ∩ typescript skills: ${matchedUserCount}`);

  // ── Inject temp counter, clear service module cache ────────────────────────
  addTempCounter();
  clearServiceCache();

  // Intercept console.log to count PHASE_F_COUNTER hits
  const origLog = console.log;
  let counterHits = 0;
  console.log = function (...args) {
    if (String(args[0] ?? '').includes(COUNTER_MARK)) counterHits++;
    origLog.apply(console, args);
  };

  // ── Run the nightly publisher pipeline ────────────────────────────────────
  let pipelineError = null;
  try {
    const { publishInsightsForPatterns } =
      require(path.resolve(__dirname, '../../services/intelligence/src/services/insightPublisher.service'));
    await publishInsightsForPatterns(patternIds);
  } catch (err) {
    pipelineError = err;
  }

  console.log = origLog;

  // ── Remove temp counter ───────────────────────────────────────────────────
  removeTempCounter();

  // ── Read back results ─────────────────────────────────────────────────────
  const { rows: insights } = await pool.query(`
    SELECT ui.source, ui.headline, ui.action, cp.role_bucket, ui.user_id
    FROM user_insights ui
    JOIN cohort_patterns cp ON cp.id = ui.pattern_id
    WHERE cp.pattern_type = 'outcome_distribution'
      AND cp.role_bucket LIKE 'test_%'
    ORDER BY cp.role_bucket, ui.created_at
  `);

  note(`Insight rows created: ${insights.length}`);

  // ── CHECK 1 — source='templated', text byte-for-byte identical to template ─
  console.log('\nCHECK 1 — source=\'templated\' and text matches buildHeadline/buildAction exactly');

  const allTemplated = insights.length > 0 && insights.every(r => r.source === 'templated');
  const textCorrect  = PATTERNS.every(tp => {
    const rows = insights.filter(r => r.role_bucket === tp.roleBucket);
    return rows.length > 0 &&
      rows.every(r => r.headline === tp.expectedHeadline && r.action === tp.expectedAction);
  });

  p(allTemplated, `All ${insights.length} rows have source='templated'`);
  p(textCorrect,  'All headlines and actions are byte-for-byte identical to template output');

  if (!textCorrect) {
    for (const tp of PATTERNS) {
      const rows = insights.filter(r => r.role_bucket === tp.roleBucket);
      if (!rows.length) { note(`  No rows found for ${tp.roleBucket}`); continue; }
      const r = rows[0];
      if (r.headline !== tp.expectedHeadline)
        note(`  ${tp.roleBucket} headline mismatch\n       got: "${r.headline}"\n       exp: "${tp.expectedHeadline}"`);
      if (r.action !== tp.expectedAction)
        note(`  ${tp.roleBucket} action mismatch\n       got: "${r.action}"\n       exp: "${tp.expectedAction}"`);
    }
  }

  // ── CHECK 2 — generateDiagnosis called once per pattern, not per user ──────
  console.log('\nCHECK 2 — generateDiagnosis called once per pattern (not once per matched user)');

  p(
    counterHits === PATTERNS.length,
    `generateDiagnosis called ${counterHits}x for ${PATTERNS.length} patterns ` +
    `(${matchedUserCount} matched users → ${matchedUserCount * PATTERNS.length} insight rows if per-user)`
  );
  if (counterHits !== PATTERNS.length) {
    note(`Expected ${PATTERNS.length}, got ${counterHits}`);
    if (counterHits === insights.length) note('Looks like it was called per insight row — bug in fan-out!');
  }

  // ── CHECK 3 — not_configured path: no crash, pipeline completes, all rows complete
  console.log('\nCHECK 3 — not_configured path: no crash, no partial/corrupted rows');

  const pipelineClean = !pipelineError;
  const allComplete   = insights.length > 0 && insights.every(r => r.headline && r.action && r.source);

  p(pipelineClean, `No uncaught exception (${pipelineError ? pipelineError.message : 'clean'})`);
  p(allComplete,   `All ${insights.length} rows have non-null headline, action, source`);

  // ── CHECK 4 — each pattern has its OWN numbers, not another pattern's ──────
  console.log('\nCHECK 4 — templated text reflects each pattern\'s actual numbers (not swapped)');

  for (const tp of PATTERNS) {
    const rows = insights.filter(r => r.role_bucket === tp.roleBucket);
    const r    = rows[0];
    if (!r) { p(false, `${tp.roleBucket}: no rows`); continue; }
    const ok = r.headline === tp.expectedHeadline && r.action === tp.expectedAction;
    p(ok, tp.roleBucket);
    note(`  headline: "${r.headline}"`);
    note(`  action:   "${r.action}"`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\n── Cleanup');
  await pool.query(`
    DELETE FROM user_insights
    WHERE pattern_id IN (
      SELECT id FROM cohort_patterns
      WHERE pattern_type = 'outcome_distribution'
        AND role_bucket LIKE 'test_%'
    )
  `);
  await pool.query(`
    DELETE FROM cohort_patterns
    WHERE pattern_type = 'outcome_distribution'
      AND role_bucket LIKE 'test_%'
  `);
  note(`Removed ${insights.length} insight rows and ${PATTERNS.length} test patterns`);

  await pool.end();
  console.log('\n══════════════════════════════════════════════════\n');
}

main().catch(err => {
  removeTempCounter(); // ensure no counter left behind even on crash
  console.error('\nFatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
