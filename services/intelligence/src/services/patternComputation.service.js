const pool       = require('../db/pool');
const insightsDb = require('../db/insights.db');

const MIN_COHORT_SIZE = 50;

async function queryCohortStats() {
  const { rows } = await pool.query(`
    SELECT
      skill_cluster,
      role_bucket,
      ats_platform,
      COUNT(*)                                                                              AS cohort_size,
      COUNT(*) FILTER (WHERE outcome = 'ghosted')                                          AS ghosted_count,
      COUNT(*) FILTER (WHERE outcome = 'rejected')                                         AS rejected_count,
      COUNT(*) FILTER (WHERE outcome = 'interview')                                        AS interview_count,
      COUNT(*) FILTER (WHERE outcome = 'offer')                                            AS offer_count,
      ROUND((COUNT(*) FILTER (WHERE outcome = 'ghosted'))::numeric  / COUNT(*)::numeric, 3) AS ghost_rate,
      ROUND((COUNT(*) FILTER (WHERE outcome = 'rejected'))::numeric / COUNT(*)::numeric, 3) AS rejection_rate,
      ROUND(AVG(ats_score::numeric), 1)                                                    AS avg_ats_score
    FROM application_events
    WHERE outcome != 'pending'
      AND applied_at >= NOW() - INTERVAL '90 days'
    GROUP BY skill_cluster, role_bucket, ats_platform
    HAVING COUNT(*) >= ${MIN_COHORT_SIZE}
  `);
  return rows;
}

function buildFinding(row) {
  return {
    ghost_rate:      parseFloat(row.ghost_rate),
    rejection_rate:  parseFloat(row.rejection_rate),
    avg_ats_score:   parseFloat(row.avg_ats_score),
    ghosted_count:   parseInt(row.ghosted_count,   10),
    rejected_count:  parseInt(row.rejected_count,  10),
    interview_count: parseInt(row.interview_count, 10),
    offer_count:     parseInt(row.offer_count,     10),
    cohort_size:     parseInt(row.cohort_size,     10),
  };
}

async function runNightlyComputation() {
  console.log('[PatternComputation] Starting nightly run');

  const rows = await queryCohortStats();
  console.log(`[PatternComputation] ${rows.length} cohort groups found`);

  const patternIds = [];

  for (const row of rows) {
    const finding = buildFinding(row);
    const id = await insightsDb.upsertCohortPattern({
      roleBucket:   row.role_bucket,
      skillCluster: row.skill_cluster,
      patternType:  'outcome_distribution',
      finding,
      cohortSize:   parseInt(row.cohort_size, 10),
    });
    patternIds.push(id);
  }

  console.log(`[PatternComputation] ${patternIds.length} patterns upserted`);
  return patternIds;
}

module.exports = { runNightlyComputation };
