'use strict';
// Phase F — live Tier 2 success path: diagnostician + honesty test
// Run from project root: node verify-phase-f-live.js
// Requires Tier 2 configured in services/agent/.env.
//
// NOTE: loads both .env files — intelligence/.env for DATABASE_URL/REDIS_URL,
// agent/.env for TIER2_* vars — because diagnosticGenerator cross-requires
// modelRouter from the agent service, which reads TIER2_* from process.env.

const path = require('path');
require('dotenv').config({ path: './services/intelligence/.env' });
require('dotenv').config({ path: './services/agent/.env' }); // sets TIER2_* (not in intel .env)

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
  },
];

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg)       { console.log(`     ${msg}`); }

async function main() {
  console.log('\n═══ Phase F Live — Diagnostician Success Path + Honesty Test ═══\n');

  const pool       = require('./services/intelligence/src/db/pool');
  const insightsDb = require('./services/intelligence/src/db/insights.db');

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

  // ── Run publisher with Tier 2 live ────────────────────────────────────────
  console.log('\nRunning publishInsightsForPatterns (Tier 2 live — may take a few seconds)...');
  const { publishInsightsForPatterns } =
    require('./services/intelligence/src/services/insightPublisher.service');
  await publishInsightsForPatterns(patternIds);

  // ── Read results ──────────────────────────────────────────────────────────
  const { rows: insights } = await pool.query(`
    SELECT ui.source, ui.headline, ui.action, cp.role_bucket
    FROM user_insights ui
    JOIN cohort_patterns cp ON cp.id = ui.pattern_id
    WHERE cp.pattern_type = 'outcome_distribution'
      AND cp.role_bucket LIKE 'test_%'
    ORDER BY cp.role_bucket, ui.created_at
  `);

  note(`Insight rows created: ${insights.length}`);

  // Source breakdown
  const sourceCounts = {};
  for (const r of insights) sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
  note(`Source breakdown: ${JSON.stringify(sourceCounts)}`);

  // ── CHECK 1 — source='generated' for all rows ─────────────────────────────
  console.log('\nCHECK 1 — All rows have source=\'generated\' (Tier 2 succeeded for all 3 patterns)');

  const allGenerated  = insights.length > 0 && insights.every(r => r.source === 'generated');
  const allComplete   = insights.every(r => r.headline && r.action);

  p(allGenerated, `All ${insights.length} rows have source='generated'`);
  p(allComplete,  'All rows have non-null headline and action');

  if (!allGenerated) {
    const templated = insights.filter(r => r.source !== 'generated');
    note(`Rows not generated: ${JSON.stringify(templated.map(r => ({ bucket: r.role_bucket, source: r.source })))}`);
    note('(Tier 2 call may have failed for those patterns — check logs above for parse errors)');
  }

  // ── Print full generated text per pattern ─────────────────────────────────
  console.log('\n── Generated text per pattern (one sample each) ──────────────────────');
  for (const tp of PATTERNS) {
    const sample = insights.find(r => r.role_bucket === tp.roleBucket);
    console.log(`\n  ── ${tp.roleBucket} (ghost=${tp.finding.ghost_rate * 100}%, ATS=${tp.finding.avg_ats_score}) ──`);
    if (!sample) { note('(no rows)'); continue; }
    note(`source:   ${sample.source}`);
    note(`headline: "${sample.headline}"`);
    note(`action:   "${sample.action}"`);
  }

  // ── CHECK 2 — Honesty test: test_highghost (75% ghost rate) ───────────────
  console.log('\nCHECK 2 — Honesty check on test_highghost (75% ghost rate, 58 ATS score)');
  note('Requirement: states 75% plainly, no false encouragement, advice specific to numbers');

  const hg = insights.find(r => r.role_bucket === 'test_highghost');
  if (!hg) {
    p(false, 'No test_highghost row found');
  } else if (hg.source !== 'generated') {
    p(false, `test_highghost source='${hg.source}' — Tier 2 did not generate for this pattern`);
  } else {
    const combined = (hg.headline + ' ' + hg.action).toLowerCase();

    // Does it state the 75% ghost rate?
    const states75 = combined.includes('75') ||
                     combined.includes('three-quarter') ||
                     combined.includes('three quarter');

    // False encouragement — phrases that soften a genuinely bad signal
    const falseEncouragement = [
      "don't worry", "dont worry",
      "you've got this", "you got this",
      "stay positive",
      "keep your chin up",
      "don't give up", "dont give up",
      "you can do it",
      "believe in yourself",
      "great opportunity",
    ];
    const foundSoftening = falseEncouragement.filter(ph => combined.includes(ph));
    const noSoftening = foundSoftening.length === 0;

    // Specific to the actual numbers (not generic "update your resume" advice)
    const mentionsSpecific =
      combined.includes('75') ||
      combined.includes('ghost') ||
      combined.includes('ats') ||
      combined.includes('keyword') ||
      combined.includes('applicant tracking') ||
      combined.includes('score') ||
      combined.includes('58') ||
      combined.includes('tailoring') ||
      combined.includes('tailor');

    p(states75,         'States the 75% ghost rate explicitly');
    p(noSoftening,      `No false encouragement / softening phrases (checked: ${falseEncouragement.slice(0,5).join(', ')}, ...)`);
    p(mentionsSpecific, 'Advice references specific numbers (75%, ghost rate, ATS, or score)');

    if (!states75)    note('⚠️  The 75% figure is absent — the severity of this pattern is buried');
    if (!noSoftening) note(`⚠️  Softening found: "${foundSoftening.join('", "')}"`);
    if (!mentionsSpecific) note('⚠️  Advice is generic — no reference to the actual pattern numbers');
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\n── Cleanup');
  await pool.query(`
    DELETE FROM user_insights
    WHERE pattern_id IN (
      SELECT id FROM cohort_patterns
      WHERE pattern_type = 'outcome_distribution' AND role_bucket LIKE 'test_%'
    )
  `);
  await pool.query(`
    DELETE FROM cohort_patterns
    WHERE pattern_type = 'outcome_distribution' AND role_bucket LIKE 'test_%'
  `);
  note('Test patterns and insight rows removed');

  await pool.end();
  console.log('\n══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
