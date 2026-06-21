'use strict';
// Step 4 verification — ClickHouse → Postgres migration
// Checks 1-5 as specified. Run from project root:
//   node scripts/dev-verification/verify-step4-pg.js

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../services/intelligence/.env'),
});

const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function p(pass, label) {
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${label}`);
  return pass;
}

// ─── Test IDs — deterministic UUIDs that can be cleaned up by prefix ─────────

const ID_CHECK1 = '00000000-0000-0000-0001-000000000001';
const ID_CHECK5 = '00000000-0000-0000-0005-000000000001';
const COHORT_ID = 'verify-step4-cohort';
const ROLE_TEST = 'test.step4.verification';

// ─── Base stripped event — reused across checks ───────────────────────────────

const BASE_EVENT = {
  applicationId:       ID_CHECK1,
  anonymisedCohortId:  'cohort-abc-001',
  roleBucket:          'software.engineer',
  skillCluster:        'javascript.typescript',
  atsScore:            82,
  companySizeBand:     3,
  atsPlatform:         'greenhouse',
  appliedAt:           new Date().toISOString(),
};

async function main() {
  const {
    insertApplicationEvent,
    updateApplicationOutcome,
  } = require(path.resolve(__dirname, '../../services/intelligence/src/services/clickhouseWriter.service'));

  const { runNightlyComputation } =
    require(path.resolve(__dirname, '../../services/intelligence/src/services/patternComputation.service'));

  const insightsDb =
    require(path.resolve(__dirname, '../../services/intelligence/src/db/insights.db'));

  const { publishInsightsForPatterns } =
    require(path.resolve(__dirname, '../../services/intelligence/src/services/insightPublisher.service'));

  // Clean any leftovers from previous runs
  await pool.query(`DELETE FROM application_events WHERE application_id IN ($1,$2)`, [ID_CHECK1, ID_CHECK5]);
  await pool.query(`DELETE FROM application_events WHERE anonymised_cohort_id = $1`, [COHORT_ID]);
  await pool.query(`DELETE FROM user_insights ui USING cohort_patterns cp
                    WHERE ui.pattern_id = cp.id AND cp.role_bucket = $1`, [ROLE_TEST]);
  await pool.query(`DELETE FROM cohort_patterns WHERE role_bucket = $1`, [ROLE_TEST]);


  // ══════════════════════════════════════════════════════════════════════════════
  //  CHECK 1 — insertApplicationEvent writes all columns correctly
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n── CHECK 1: insertApplicationEvent writes a row correctly\n');

  await insertApplicationEvent(BASE_EVENT);

  const { rows: [r1] } = await pool.query(
    'SELECT * FROM application_events WHERE application_id = $1', [ID_CHECK1],
  );

  p(!!r1,                                  'row exists after insert');
  p(r1?.application_id      === ID_CHECK1, `application_id   = ${r1?.application_id}`);
  p(r1?.anonymised_cohort_id === 'cohort-abc-001', `anonymised_cohort_id = ${r1?.anonymised_cohort_id}`);
  p(r1?.role_bucket         === 'software.engineer',       `role_bucket      = ${r1?.role_bucket}`);
  p(r1?.skill_cluster       === 'javascript.typescript',   `skill_cluster    = ${r1?.skill_cluster}`);
  p(r1?.ats_score           === 82,        `ats_score        = ${r1?.ats_score}`);
  p(r1?.company_size_band   === 3,         `company_size_band= ${r1?.company_size_band}`);
  p(r1?.ats_platform        === 'greenhouse', `ats_platform   = ${r1?.ats_platform}`);
  p(r1?.outcome             === 'pending', `outcome          = ${r1?.outcome}  (initially pending)`);
  p(r1?.response_days       === null,      `response_days    = ${r1?.response_days}  (initially null)`);
  p(!!r1?.applied_at,                      `applied_at       = ${r1?.applied_at}`);


  // ══════════════════════════════════════════════════════════════════════════════
  //  CHECK 2 — updateApplicationOutcome updates in-place, no duplicate
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n── CHECK 2: updateApplicationOutcome updates in-place, not a duplicate\n');

  await updateApplicationOutcome(ID_CHECK1, 'ghosted', 14);

  const { rows: after2 } = await pool.query(
    'SELECT * FROM application_events WHERE application_id = $1', [ID_CHECK1],
  );

  p(after2.length === 1,            `exactly 1 row (no duplicate) — found ${after2.length}`);
  p(after2[0]?.outcome === 'ghosted', `outcome        = ${after2[0]?.outcome}  (was: pending)`);
  p(after2[0]?.response_days === 14,  `response_days  = ${after2[0]?.response_days}  (was: null)`);


  // ══════════════════════════════════════════════════════════════════════════════
  //  CHECK 3 — nightly pattern computation: same output shape, cohort_size >= 50
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n── CHECK 3: nightly pattern computation produces correct output shape\n');

  // Seed 55 rows — 30 ghosted, 15 rejected, 7 interview, 3 offer
  const outcomes55 = [
    ...Array(30).fill('ghosted'),
    ...Array(15).fill('rejected'),
    ...Array(7).fill('interview'),
    ...Array(3).fill('offer'),
  ];
  for (let i = 0; i < 55; i++) {
    const uuid = `00000000-0000-0000-0003-${String(i).padStart(12, '0')}`;
    await pool.query(
      `INSERT INTO application_events
         (application_id, anonymised_cohort_id, role_bucket, skill_cluster,
          ats_score, company_size_band, ats_platform, outcome, response_days, applied_at)
       VALUES ($1, $2, $3, 'python.ml', $4, null, 'lever', $5, null, NOW() - INTERVAL '1 day')
       ON CONFLICT DO NOTHING`,
      [uuid, COHORT_ID, ROLE_TEST, 50 + i, outcomes55[i]],
    );
  }

  const patternIds = await runNightlyComputation();
  p(patternIds.length >= 1, `runNightlyComputation returned ${patternIds.length} pattern id(s)`);

  const { rows: [cp] } = await pool.query(
    `SELECT * FROM cohort_patterns WHERE role_bucket = $1 ORDER BY computed_at DESC LIMIT 1`,
    [ROLE_TEST],
  );
  p(!!cp,                             'cohort_patterns row exists for test cohort');
  p(cp?.cohort_size >= 50,           `cohort_size gate: ${cp?.cohort_size} >= 50`);

  const f = cp?.finding ?? {};
  p(typeof f.ghost_rate     === 'number', `finding.ghost_rate     is a number: ${f.ghost_rate}`);
  p(typeof f.rejection_rate === 'number', `finding.rejection_rate is a number: ${f.rejection_rate}`);
  p(typeof f.avg_ats_score  === 'number', `finding.avg_ats_score  is a number: ${f.avg_ats_score}`);
  p(typeof f.ghosted_count  === 'number', `finding.ghosted_count  is a number: ${f.ghosted_count}`);
  p(typeof f.cohort_size    === 'number', `finding.cohort_size    is a number: ${f.cohort_size}`);
  p(f.ghosted_count  === 30,              `finding.ghosted_count  = ${f.ghosted_count}  (expected 30)`);
  p(f.rejected_count === 15,              `finding.rejected_count = ${f.rejected_count}  (expected 15)`);
  p(f.cohort_size    === 55,              `finding.cohort_size    = ${f.cohort_size}  (expected 55)`);
  p(Math.abs(f.ghost_rate - 0.545) < 0.002, `finding.ghost_rate     = ${f.ghost_rate}  (expected ~0.545)`);


  // ══════════════════════════════════════════════════════════════════════════════
  //  CHECK 4 — Phase F diagnostician: source='templated', unaffected by swap
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n── CHECK 4: Phase F diagnostician end-to-end (source=templated)\n');

  const PHASE_F_PATTERN = {
    roleBucket:   'test.step4.diag',
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
  };
  const EXPECTED_HEADLINE = '75% of javascript, typescript test.step4.diag applicants are ghosted — avg ATS score: 58';
  const EXPECTED_ACTION   = 'Consider tailoring your resume keywords more closely to the JD. The average ATS score for successful candidates in this cohort is 58.';

  // Clean before seeding
  await pool.query(`DELETE FROM user_insights ui USING cohort_patterns cp
                    WHERE ui.pattern_id = cp.id AND cp.role_bucket = 'test.step4.diag'`);
  await pool.query(`DELETE FROM cohort_patterns WHERE role_bucket = 'test.step4.diag'`);

  const diagPatternId = await insightsDb.upsertCohortPattern(PHASE_F_PATTERN);

  let pipelineErr = null;
  try {
    await publishInsightsForPatterns([diagPatternId]);
  } catch (e) {
    pipelineErr = e;
  }

  p(!pipelineErr, `pipeline completed without exception${pipelineErr ? ': ' + pipelineErr.message : ''}`);

  const { rows: insights } = await pool.query(
    `SELECT ui.source, ui.headline, ui.action
     FROM user_insights ui
     JOIN cohort_patterns cp ON cp.id = ui.pattern_id
     WHERE cp.role_bucket = 'test.step4.diag'`,
  );

  p(insights.length > 0,                            `${insights.length} insight row(s) created`);
  p(insights.every(r => r.source === 'templated'),  `all rows source='templated'`);
  p(insights.every(r => r.headline === EXPECTED_HEADLINE), `headline correct`);
  p(insights.every(r => r.action   === EXPECTED_ACTION),   `action correct`);

  // Phase F cleanup
  await pool.query(`DELETE FROM user_insights ui USING cohort_patterns cp
                    WHERE ui.pattern_id = cp.id AND cp.role_bucket = 'test.step4.diag'`);
  await pool.query(`DELETE FROM cohort_patterns WHERE role_bucket = 'test.step4.diag'`);


  // ══════════════════════════════════════════════════════════════════════════════
  //  CHECK 5 — at-least-once retry: DO NOTHING protects real outcome
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n── CHECK 5: BullMQ retry — second insert does NOT revert outcome\n');

  const raceEvent = { ...BASE_EVENT, applicationId: ID_CHECK5 };

  // First insert — outcome starts as 'pending'
  await insertApplicationEvent(raceEvent);

  // Real outcome set between retries
  await updateApplicationOutcome(ID_CHECK5, 'offer', 7);

  // Simulated BullMQ at-least-once retry of the original insert job
  await insertApplicationEvent(raceEvent);

  const { rows: [raceRow] } = await pool.query(
    'SELECT outcome, response_days FROM application_events WHERE application_id = $1', [ID_CHECK5],
  );

  p(raceRow?.outcome       === 'offer', `outcome after retry = '${raceRow?.outcome}' (must not be 'pending')`);
  p(raceRow?.response_days === 7,       `response_days after retry = ${raceRow?.response_days} (must not be null)`);


  // ─── Cleanup all test data ────────────────────────────────────────────────
  console.log('\n── Cleanup');
  await pool.query(`DELETE FROM application_events WHERE application_id IN ($1,$2)`, [ID_CHECK1, ID_CHECK5]);
  await pool.query(`DELETE FROM application_events WHERE anonymised_cohort_id = $1`, [COHORT_ID]);
  await pool.query(`DELETE FROM cohort_patterns WHERE role_bucket = $1`, [ROLE_TEST]);

  console.log('  done\n');
  await pool.end();
}

main().catch(async (err) => {
  console.error('\nFatal:', err.message, '\n', err.stack);
  await pool.end().catch(() => {});
  process.exit(1);
});
