const pool = require('./pool');

async function getResumeByUserId(userId) {
  const { rows } = await pool.query(
    'SELECT resume_json FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.resume_json || null;
}

module.exports = { getResumeByUserId };
