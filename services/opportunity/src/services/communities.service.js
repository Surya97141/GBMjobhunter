const { COMMUNITIES } = require('../data/communities');

function findMatchingCommunities(skills, interests) {
  const userTerms = new Set(
    [...skills, ...interests].map(s => String(s).toLowerCase().trim())
  );

  const scored = COMMUNITIES.map(community => {
    const matchCount = community.tags.filter(tag => userTerms.has(tag)).length;
    return { ...community, matchCount };
  });

  return scored
    .filter(c => c.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .map(({ matchCount: _, ...community }) => community);
}

module.exports = { findMatchingCommunities };
