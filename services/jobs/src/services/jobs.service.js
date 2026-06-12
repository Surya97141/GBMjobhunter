const skillDemandDb = require('../db/skillDemand.db');

async function getDemandSupplyMap(skill, region) {
  if (skill && region) {
    return skillDemandDb.getSkillDemandHistory(skill, region);
  }
  return skillDemandDb.getLatestSkillDemand();
}

module.exports = { getDemandSupplyMap };
