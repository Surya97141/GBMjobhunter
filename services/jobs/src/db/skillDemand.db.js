const pool = require('./pool');

async function getLatestSkillDemand() {
  const { rows } = await pool.query(
    `SELECT skill, region, open_roles, applicant_pool, heat_score, week
     FROM skill_demand
     WHERE week = (SELECT MAX(week) FROM skill_demand)
     ORDER BY heat_score DESC`
  );
  return rows;
}

async function getSkillDemandHistory(skill, region) {
  const { rows } = await pool.query(
    `SELECT skill, region, open_roles, applicant_pool, heat_score, week
     FROM skill_demand
     WHERE skill = $1 AND region = $2
     ORDER BY week ASC`,
    [skill, region]
  );
  return rows;
}

module.exports = { getLatestSkillDemand, getSkillDemandHistory };
