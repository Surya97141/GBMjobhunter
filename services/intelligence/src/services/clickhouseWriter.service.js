const { client } = require('../db/clickhouse');

async function insertApplicationEvent(stripped) {
  await client.insert({
    table:  'application_events',
    values: [{
      application_id:       stripped.applicationId,
      anonymised_cohort_id: stripped.anonymisedCohortId,
      role_bucket:          stripped.roleBucket || 'unspecified',
      skill_cluster:        stripped.skillCluster,
      ats_score:            stripped.atsScore    ?? null,
      company_size_band:    stripped.companySizeBand ?? null,
      ats_platform:         stripped.atsPlatform || 'unknown',
      outcome:              'pending',
      response_days:        null,
      applied_at:           new Date(stripped.appliedAt).toISOString().replace('T', ' ').slice(0, 19),
    }],
    format: 'JSONEachRow',
  });
}

async function updateOutcomeInClickhouse(applicationId, outcome, responseDays) {
  const { rows } = await client.query({
    query: `
      SELECT application_id, anonymised_cohort_id, role_bucket,
             skill_cluster, ats_score, company_size_band, ats_platform, applied_at
      FROM application_events FINAL
      WHERE application_id = {applicationId: String}
      LIMIT 1
    `,
    query_params: { applicationId },
    format: 'JSONEachRow',
  }).then(r => r.json());

  if (!rows || rows.length === 0) return;

  const existing = rows[0];
  await client.insert({
    table: 'application_events',
    values: [{
      ...existing,
      outcome,
      response_days: responseDays ?? null,
    }],
    format: 'JSONEachRow',
  });
}

module.exports = { insertApplicationEvent, updateOutcomeInClickhouse };
