const { SKILL_GRAPH }            = require('../data/skillPaths');
const { COURSES }                = require('../data/courses');
const { fetchSkillImpactScores } = require('../db/cohortPatterns.db');

const LEVEL_ORDER      = { foundational: 0, intermediate: 1, advanced: 2 };
const REAL_DATA_WEIGHT = 20;

function normalise(s) {
  return String(s).toLowerCase().trim();
}

function buildReason(finding) {
  const pct         = Math.round(finding.skillSuccessRate    * 100);
  const baselinePct = Math.round(finding.baselineSuccessRate * 100);
  const sampleSize  = finding.sampleSize;

  if (finding.liftScore >= 0) {
    return `Applicants with this skill have a ${pct}% success rate, compared to ${baselinePct}% platform average, based on ${sampleSize} applications.`;
  }
  return `Applicants with this skill have a ${pct}% success rate, slightly below the ${baselinePct}% platform average — this skill alone may not be the gap, consider other factors.`;
}

async function buildRecommendations(currentSkills, interests) {
  const known     = new Set([...currentSkills, ...interests].map(normalise));
  const impactMap = await fetchSkillImpactScores();

  const candidates = [];

  for (const [skill, meta] of Object.entries(SKILL_GRAPH)) {
    if (known.has(skill)) continue;

    const prereqsMet = meta.prerequisites.every(p => known.has(normalise(p)));
    if (!prereqsMet) continue;

    const prereqOverlap = meta.prerequisites.filter(p => known.has(normalise(p))).length;
    const interestBoost = interests.map(normalise).some(i =>
      skill.includes(i) || (meta.domain && meta.domain === i)
    ) ? 1 : 0;

    const finding       = impactMap[normalise(skill)];
    const hasCohortData = Boolean(finding);
    const score         = hasCohortData
      ? prereqOverlap + interestBoost + (finding.liftScore * REAL_DATA_WEIGHT)
      : prereqOverlap + interestBoost;

    candidates.push({
      skill,
      level:      meta.level,
      domain:     meta.domain,
      score,
      courses:    COURSES[skill] || [],
      dataSource: hasCohortData ? 'cohort' : 'heuristic',
      ...(hasCohortData && { reason: buildReason(finding) }),
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  });

  return candidates.slice(0, 10);
}

module.exports = { buildRecommendations };
