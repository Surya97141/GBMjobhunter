const pool = require('./pool');

async function getInsightsByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT
       ui.id,
       ui.headline,
       ui.action,
       ui.seen,
       ui.created_at,
       cp.pattern_type,
       cp.cohort_size,
       cp.finding,
       cp.computed_at
     FROM user_insights ui
     JOIN cohort_patterns cp ON cp.id = ui.pattern_id
     WHERE ui.user_id = $1
     ORDER BY ui.seen ASC, ui.created_at DESC`,
    [userId]
  );
  return rows;
}

async function markInsightSeen(id, userId) {
  const { rows } = await pool.query(
    `UPDATE user_insights
     SET seen = true
     WHERE id = $1 AND user_id = $2
     RETURNING id, seen`,
    [id, userId]
  );
  return rows[0] ?? null;
}

module.exports = { getInsightsByUserId, markInsightSeen };
