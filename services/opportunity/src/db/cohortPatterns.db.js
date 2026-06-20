const pool = require('./pool');

// Fetches the full skill_impact table on every call — caching candidate once
// this table grows beyond a trivial size (e.g. via an in-process TTL map).
async function fetchSkillImpactScores() {
  const { rows } = await pool.query(
    `SELECT skill_cluster, finding
     FROM cohort_patterns
     WHERE pattern_type = 'skill_impact'`
  );

  const map = {};
  for (const row of rows) {
    const finding = typeof row.finding === 'string' ? JSON.parse(row.finding) : row.finding;
    map[row.skill_cluster] = finding;
  }
  return map;
}

module.exports = { fetchSkillImpactScores };
