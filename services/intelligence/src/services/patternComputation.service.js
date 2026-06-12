const { client } = require('../db/clickhouse');
const insightsDb = require('../db/insights.db');

const MIN_COHORT_SIZE = 50;

async function queryCohortStats() {
  const result = await client.query({
    query: `
      SELECT
        skill_cluster,
        role_bucket,
        ats_platform,
        count()                                             AS cohort_size,
        countIf(outcome = 'ghosted')                        AS ghosted_count,
        countIf(outcome = 'rejected')                       AS rejected_count,
        countIf(outcome = 'interview')                      AS interview_count,
        countIf(outcome = 'offer')                          AS offer_count,
        round(countIf(outcome = 'ghosted')  / count(), 3)  AS ghost_rate,
        round(countIf(outcome = 'rejected') / count(), 3)  AS rejection_rate,
        round(avg(ats_score), 1)                            AS avg_ats_score
      FROM application_events FINAL
      WHERE outcome != 'pending'
        AND applied_at >= now() - INTERVAL 90 DAY
      GROUP BY skill_cluster, role_bucket, ats_platform
      HAVING cohort_size >= ${MIN_COHORT_SIZE}
    `,
    format: 'JSONEachRow',
  });
  return result.json();
}

function buildFinding(row) {
  return {
    ghost_rate:      row.ghost_rate,
    rejection_rate:  row.rejection_rate,
    avg_ats_score:   row.avg_ats_score,
    ghosted_count:   row.ghosted_count,
    rejected_count:  row.rejected_count,
    interview_count: row.interview_count,
    offer_count:     row.offer_count,
    cohort_size:     row.cohort_size,
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
