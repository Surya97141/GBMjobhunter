const pool = require('./pool');

async function findUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, email, hashed_password, ats_score_cache, created_at FROM users WHERE email = $1',
    [email]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, ats_score_cache, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function createUser({ id, email, hashedPassword }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, hashed_password)
     VALUES ($1, $2, $3)
     RETURNING id, email, created_at`,
    [id, email, hashedPassword]
  );
  return rows[0];
}

async function updateUserProfile(id, { email }) {
  const { rows } = await pool.query(
    `UPDATE users SET email = $1 WHERE id = $2
     RETURNING id, email, ats_score_cache, created_at`,
    [email, id]
  );
  return rows[0] || null;
}

async function saveResume(id, resumeJson) {
  const { rows } = await pool.query(
    `UPDATE users SET resume_json = $1 WHERE id = $2
     RETURNING id, email, resume_json, ats_score_cache, created_at`,
    [resumeJson, id]
  );
  return rows[0] || null;
}

async function getResume(id) {
  const { rows } = await pool.query(
    'SELECT resume_json FROM users WHERE id = $1',
    [id]
  );
  return rows[0]?.resume_json || null;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserProfile,
  saveResume,
  getResume,
};
