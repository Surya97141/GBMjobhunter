const pool = require('./pool');

// Read-only company signals for outreach tone calibration.
// Deliberately SELECT-only — findOrCreateCompany in the jobs service owns inserts.
async function getCompanySignals(companyName) {
  const { rows } = await pool.query(
    `SELECT ats_platform, ghost_rate, avg_response_days, size_band
     FROM companies
     WHERE LOWER(name) = LOWER($1)
     LIMIT 1`,
    [companyName.trim()]
  );
  return rows[0] ?? null;
}

// Read-only user skills — mirrors getResumeByUserId in intelligence's users.db.js:
// same SELECT resume_json query, skills extracted in JS rather than SQL.
async function getUserSkills(userId) {
  const { rows } = await pool.query(
    'SELECT resume_json FROM users WHERE id = $1',
    [userId]
  );
  const skills = rows[0]?.resume_json?.skills;
  return Array.isArray(skills) ? skills : [];
}

module.exports = { getCompanySignals, getUserSkills };
