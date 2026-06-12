const pool = require('./pool');

async function getResumeByUserId(userId) {
  const { rows } = await pool.query(
    'SELECT resume_json FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.resume_json || null;
}

async function getUsersWithSkillsIn(skills) {
  if (!skills.length) return [];
  const placeholders = skills.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `SELECT id, resume_json
     FROM users
     WHERE resume_json IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(resume_json->'skills') s
         WHERE LOWER(s) = ANY(ARRAY[${placeholders}])
       )`,
    skills.map(s => s.toLowerCase())
  );
  return rows;
}

module.exports = { getResumeByUserId, getUsersWithSkillsIn };
