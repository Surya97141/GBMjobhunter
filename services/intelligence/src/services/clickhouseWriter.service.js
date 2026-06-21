const pool = require('../db/pool');

async function insertApplicationEvent(stripped) {
  await pool.query(
    `INSERT INTO application_events
       (application_id, anonymised_cohort_id, role_bucket, skill_cluster,
        ats_score, company_size_band, ats_platform, outcome, response_days, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (application_id) DO NOTHING`,
    [
      stripped.applicationId,
      stripped.anonymisedCohortId,
      stripped.roleBucket      || 'unspecified',
      stripped.skillCluster,
      stripped.atsScore        ?? null,
      stripped.companySizeBand ?? null,
      stripped.atsPlatform     || 'unknown',
      'pending',
      null,
      new Date(stripped.appliedAt).toISOString(),
    ]
  );
}

async function updateApplicationOutcome(applicationId, outcome, responseDays) {
  await pool.query(
    `UPDATE application_events
     SET outcome = $1, response_days = $2
     WHERE application_id = $3`,
    [outcome, responseDays ?? null, applicationId]
  );
}

module.exports = { insertApplicationEvent, updateApplicationOutcome };
