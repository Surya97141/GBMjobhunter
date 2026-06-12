const pool = require('./pool');
const { v4: uuidv4 } = require('uuid');

async function findOrCreateCompany(name, atsPlatform) {
  const normalised = name.trim().toLowerCase();

  const existing = await pool.query(
    'SELECT id, name, ats_platform, ghost_rate, avg_response_days, size_band FROM companies WHERE LOWER(name) = $1',
    [normalised]
  );

  if (existing.rows[0]) return existing.rows[0];

  const { rows } = await pool.query(
    `INSERT INTO companies (id, name, ats_platform)
     VALUES ($1, $2, $3)
     RETURNING id, name, ats_platform, ghost_rate, avg_response_days, size_band`,
    [uuidv4(), name.trim(), atsPlatform || null]
  );

  return rows[0];
}

module.exports = { findOrCreateCompany };
