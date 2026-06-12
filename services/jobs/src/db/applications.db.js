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

async function getApplicationsByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.role_title, a.jd_fingerprint_hash, a.ats_score_at_apply,
       a.outcome, a.response_days, a.applied_at,
       c.id   AS company_id,
       c.name AS company_name,
       c.ats_platform, c.ghost_rate, c.avg_response_days
     FROM applications a
     JOIN companies c ON a.company_id = c.id
     WHERE a.user_id = $1
     ORDER BY a.applied_at DESC`,
    [userId]
  );
  return rows;
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
  findApplicationById,
  updateOutcome,
};
