const pool = require('./pool');
const { v4: uuidv4 } = require('uuid');

async function upsertCohortPattern({ roleBucket, skillCluster, patternType, finding, cohortSize }) {
  const { rows } = await pool.query(
    `INSERT INTO cohort_patterns
       (id, role_bucket, skill_cluster, pattern_type, finding, cohort_size, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (role_bucket, skill_cluster, pattern_type)
     DO UPDATE SET
       finding     = EXCLUDED.finding,
       cohort_size = EXCLUDED.cohort_size,
       computed_at = NOW()
     RETURNING id`,
    [uuidv4(), roleBucket, skillCluster, patternType, JSON.stringify(finding), cohortSize]
  );
  return rows[0].id;
}

async function getPatternsByIds(ids) {
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `SELECT * FROM cohort_patterns WHERE id IN (${placeholders})`,
    ids
  );
  return rows;
}

async function createUserInsight({ userId, patternId, headline, action, source = 'templated' }) {
  await pool.query(
    `INSERT INTO user_insights (id, user_id, pattern_id, headline, action, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [uuidv4(), userId, patternId, headline, action, source]
  );
}

async function getUnseenInsightCountForUser(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) FROM user_insights WHERE user_id = $1 AND seen = FALSE',
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = {
  upsertCohortPattern,
  getPatternsByIds,
  createUserInsight,
  getUnseenInsightCountForUser,
};
