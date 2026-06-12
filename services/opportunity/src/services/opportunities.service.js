const { SKILL_GRAPH } = require('../data/skillPaths');
const { COURSES }     = require('../data/courses');

const LEVEL_ORDER = { foundational: 0, intermediate: 1, advanced: 2 };

function normalise(s) {
  return String(s).toLowerCase().trim();
}

function buildRecommendations(currentSkills, interests) {
  const known = new Set([...currentSkills, ...interests].map(normalise));

  const candidates = [];

  for (const [skill, meta] of Object.entries(SKILL_GRAPH)) {
    if (known.has(skill)) continue;

    const prereqsMet = meta.prerequisites.every(p => known.has(normalise(p)));
    if (!prereqsMet) continue;

    const prereqOverlap = meta.prerequisites.filter(p => known.has(normalise(p))).length;
    const interestBoost  = interests.map(normalise).some(i =>
      skill.includes(i) || (meta.domain && meta.domain === i)
    ) ? 1 : 0;

    candidates.push({
      skill,
      level:    meta.level,
      domain:   meta.domain,
      score:    prereqOverlap + interestBoost,
      courses:  COURSES[skill] || [],
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  });

  return candidates.slice(0, 10);
}

module.exports = { buildRecommendations };
