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

  // The AI planner is optional: with no AI configured anywhere, the
  // deterministic engine must give the same results it always has.
  it('works without any AI configuration and is repeatable', async () => {
    const saved = {};
    for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'TIER2_API_KEY', 'TIER3_API_KEY', 'AGENT_SERVICE_URL']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const first  = await buildRecommendations(['JavaScript', 'SQL'], []);
      const second = await buildRecommendations(['JavaScript', 'SQL'], []);
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
      for (const r of first) {
        expect(r.dataSource).toBe('heuristic');
        for (const c of r.courses) expect(c.url).toMatch(/^https:\/\//);
      }
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });
});
