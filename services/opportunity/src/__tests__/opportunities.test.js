// Cohort data comes from Postgres; mocked so the deterministic engine is tested alone.
jest.mock('../db/cohortPatterns.db', () => ({ fetchSkillImpactScores: jest.fn() }));

const { fetchSkillImpactScores } = require('../db/cohortPatterns.db');
const { buildRecommendations }   = require('../services/opportunities.service');

beforeEach(() => {
  fetchSkillImpactScores.mockResolvedValue({});
});

describe('buildRecommendations', () => {
  it('lists which of the user\'s own skills lead into each recommendation', async () => {
    const recs = await buildRecommendations(['JavaScript'], []);
    const react = recs.find(r => r.skill === 'react');
    expect(react).toBeDefined();
    expect(react.matchedPrerequisites).toEqual(['javascript']);
  });

  it('never recommends a skill the user already has', async () => {
    const recs = await buildRecommendations(['JavaScript', 'React'], []);
    expect(recs.map(r => r.skill)).not.toContain('react');
    expect(recs.map(r => r.skill)).not.toContain('javascript');
  });

  it('only recommends skills whose prerequisites are all met', async () => {
    const recs = await buildRecommendations(['JavaScript'], []);
    // next.js needs react, which this user does not have.
    expect(recs.map(r => r.skill)).not.toContain('next.js');
  });

  it('marks recommendations without cohort data as heuristic, with no invented reason', async () => {
    const recs = await buildRecommendations(['JavaScript'], []);
    for (const r of recs) {
      expect(r.dataSource).toBe('heuristic');
      expect(r.reason).toBeUndefined();
    }
  });

  it('returns at most 10 recommendations', async () => {
    const recs = await buildRecommendations([], []);
    expect(recs.length).toBeLessThanOrEqual(10);
  });
});
