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
    `SELECT
       id, email, name, ats_score_cache,
       target_role, target_location,
       years_of_experience, created_at
     FROM users
     WHERE id = $1`,
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

// Dynamically patches only the fields that are passed in.
// Allowed keys are whitelisted to prevent injection via field name.
// Dollar-sign placeholders are built from the allowed list — never from user input.
async function updateUserProfile(userId, fields) {
  const ALLOWED = [
    'name', 'email',
    'target_role', 'target_location',
    'years_of_experience',
  ];

  const updates = [];
  const values  = [];
  let i = 1;

  for (const key of ALLOWED) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${i}`);
      values.push(fields[key]);
      i++;
    }
  }

  if (updates.length === 0) return null;

  values.push(userId);

  const { rows } = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = $${i}
     RETURNING
       id, email, name, ats_score_cache,
       target_role, target_location,
       years_of_experience, created_at`,
    values
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

async function updateAtsCache(id, score) {
  const { rows } = await pool.query(
    `UPDATE users SET ats_score_cache = $1 WHERE id = $2
     RETURNING id, email, ats_score_cache, created_at`,
    [score, id]
  );
  return rows[0] || null;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserProfile,
  saveResume,
  getResume,
  updateAtsCache,
};
