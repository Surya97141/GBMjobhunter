const pool = require('./pool');

async function createApplication({ id, userId, companyId, roleTitle, jdFingerprintHash, atsScoreAtApply }) {
  const { rows } = await pool.query(
    `INSERT INTO applications
       (id, user_id, company_id, role_title, jd_fingerprint_hash, ats_score_at_apply)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, userId, companyId, roleTitle, jdFingerprintHash, atsScoreAtApply]
  );
  return rows[0];
}

async function getApplicationsByUserId(userId, limit = null, offset = 0) {
  let query = `
    SELECT
      a.id, a.role_title, a.jd_fingerprint_hash, a.ats_score_at_apply,
      a.outcome, a.response_days, a.applied_at,
      c.id   AS company_id,
      c.name AS company_name,
      c.ats_platform, c.ghost_rate, c.avg_response_days
    FROM applications a
    JOIN companies c ON a.company_id = c.id
    WHERE a.user_id = $1
    ORDER BY a.applied_at DESC
  `;

  const params = [userId];

  if (limit !== null) {
    params.push(limit);
    params.push(offset);
    query += ` LIMIT $2 OFFSET $3`;
  }

  const { rows } = await pool.query(query, params);
  return rows;
}

async function getApplicationStats(userId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                                     AS total,
       COUNT(*) FILTER (WHERE outcome IN ('interview', 'offer'))   AS interviews,
       COUNT(*) FILTER (WHERE outcome = 'ghosted')                 AS ghosted,
       COUNT(*) FILTER (WHERE outcome = 'offer')                   AS offers,
       COUNT(*) FILTER (WHERE outcome = 'rejected')                AS rejected,
       COUNT(*) FILTER (WHERE outcome = 'pending')                 AS pending,
       ROUND(AVG(ats_score_at_apply))                              AS avg_ats_score,
       MAX(ats_score_at_apply)                                     AS best_ats_score
     FROM applications
     WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  return {
    total:          Number(row.total)          || 0,
    interviews:     Number(row.interviews)     || 0,
    ghosted:        Number(row.ghosted)        || 0,
    offers:         Number(row.offers)         || 0,
    rejected:       Number(row.rejected)       || 0,
    pending:        Number(row.pending)        || 0,
    avg_ats_score:  Number(row.avg_ats_score)  || 0,
    best_ats_score: Number(row.best_ats_score) || 0,
  };
}

async function findApplicationById(id, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

async function updateOutcome(id, userId, outcome, responseDays) {
  const { rows } = await pool.query(
    `UPDATE applications
     SET outcome = $1, response_days = $2
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [outcome, responseDays, id, userId]
  );
  return rows[0] || null;
}

module.exports = {
  createApplication,
  getApplicationsByUserId,
  getApplicationStats,
  findApplicationById,
  updateOutcome,
};
