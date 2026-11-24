jest.mock('../db/pool', () => ({ query: jest.fn() }));
jest.mock('../db/insights.db', () => ({ upsertCohortPattern: jest.fn() }));

const pool       = require('../db/pool');
const insightsDb = require('../db/insights.db');
const { insertApplicationEvent, updateApplicationOutcome } = require('../services/clickhouseWriter.service');
const { runNightlyComputation } = require('../services/patternComputation.service');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('insertApplicationEvent', () => {
  const stripped = {
    applicationId: 'app-1', anonymisedCohortId: 'cohort1', skillCluster: 'react.sql',
    atsScore: 72, appliedAt: '2026-01-01T00:00:00.000Z',
  };

  // BullMQ delivers at-least-once. DO NOTHING stops a retried "application
  // logged" job from resetting a real outcome (e.g. ghosted) back to pending.
  it('is idempotent: uses ON CONFLICT DO NOTHING keyed on application_id', async () => {
    await insertApplicationEvent(stripped);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(application_id\) DO NOTHING/);
  });

  it('inserts as pending and applies defaults for missing fields', async () => {
    await insertApplicationEvent(stripped);
    const params = pool.query.mock.calls[0][1];
    expect(params).toEqual([
      'app-1', 'cohort1', 'unspecified', 'react.sql', 72, null, 'unknown',
      'pending', null, '2026-01-01T00:00:00.000Z',
    ]);
  });
});

describe('updateApplicationOutcome', () => {
  it('updates the outcome and response days', async () => {
    await updateApplicationOutcome('app-1', 'ghosted', 14);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE application_events'), ['ghosted', 14, 'app-1']);
  });

  it('stores null when responseDays is not provided', async () => {
    await updateApplicationOutcome('app-1', 'offer');
    expect(pool.query.mock.calls[0][1]).toEqual(['offer', null, 'app-1']);
  });
});

describe('runNightlyComputation', () => {
  // pg returns COUNT/ROUND results as strings; the code must parse them.
  const row = {
    skill_cluster: 'react.sql', role_bucket: 'frontend', ats_platform: 'greenhouse',
    cohort_size: '120', ghosted_count: '60', rejected_count: '30',
    interview_count: '20', offer_count: '10',
    ghost_rate: '0.500', rejection_rate: '0.250', avg_ats_score: '68.4',
  };

  it('enforces a minimum cohort size of 50 in the query', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await runNightlyComputation();
    expect(pool.query.mock.calls[0][0]).toMatch(/HAVING COUNT\(\*\) >= 50/);
  });

  it('only counts resolved applications from the last 90 days', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await runNightlyComputation();
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/outcome != 'pending'/);
    expect(sql).toMatch(/INTERVAL '90 days'/);
  });

  it('upserts one outcome_distribution pattern per cohort with numeric findings', async () => {
    pool.query.mockResolvedValue({ rows: [row] });
    insightsDb.upsertCohortPattern.mockResolvedValue('pattern-1');

    const ids = await runNightlyComputation();

    expect(ids).toEqual(['pattern-1']);
    expect(insightsDb.upsertCohortPattern).toHaveBeenCalledWith({
      roleBucket:   'frontend',
      skillCluster: 'react.sql',
      patternType:  'outcome_distribution',
      cohortSize:   120,
      finding: {
        ghost_rate: 0.5, rejection_rate: 0.25, avg_ats_score: 68.4,
        ghosted_count: 60, rejected_count: 30, interview_count: 20,
        offer_count: 10, cohort_size: 120,
      },
    });
  });

  it('does nothing when no cohort reaches the minimum size', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await runNightlyComputation()).toEqual([]);
    expect(insightsDb.upsertCohortPattern).not.toHaveBeenCalled();
  });
});
