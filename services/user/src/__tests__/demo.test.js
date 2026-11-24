process.env.JWT_SECRET   = 'test-secret-for-jest';
process.env.DATABASE_URL = 'postgres://mock';

const request = require('supertest');
const jwt     = require('jsonwebtoken');

// A fake pg client that records every query so we can assert on the seeding.
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../db/pool', () => ({
  query:   jest.fn(),
  connect: jest.fn(),
}));
// Other modules that load with the app; the demo route doesn't use them.
jest.mock('../db/users.db', () => ({}));

const pool = require('../db/pool');
const app  = require('../../index');
const { DEMO_APPLICATIONS, DEMO_PATTERNS } = require('../demo/demoData');

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
  // Default fake DB: company lookups find nothing, pattern upserts return an id.
  mockClient.query.mockImplementation(async (sql) => {
    if (/RETURNING id/.test(sql)) return { rows: [{ id: 'pattern-id' }] };
    return { rows: [] };
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { delete process.env.DEMO_MODE_ENABLED; });

describe('POST /auth/demo', () => {
  it('returns 404 when demo mode is not enabled (real deployments)', async () => {
    const res = await request(app).post('/auth/demo');
    expect(res.status).toBe(404);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  describe('with DEMO_MODE_ENABLED=true', () => {
    beforeEach(() => { process.env.DEMO_MODE_ENABLED = 'true'; });

    it('returns 201 with a token whose subject is the new demo user', async () => {
      const res = await request(app).post('/auth/demo');

      expect(res.status).toBe(201);
      const { user, token } = res.body.data;
      expect(user.is_demo).toBe(true);
      expect(user.email).toMatch(/^demo-.+@demo\.invalid$/);
      expect(jwt.verify(token, process.env.JWT_SECRET).sub).toBe(user.id);
    });

    it('creates a flagged demo user and seeds every sample application', async () => {
      await request(app).post('/auth/demo');

      const sqls = mockClient.query.mock.calls.map(c => c[0]);
      const userInsert = sqls.find(s => /INSERT INTO users/.test(s));
      expect(userInsert).toMatch(/is_demo/);
      expect(sqls.filter(s => /INSERT INTO applications/.test(s))).toHaveLength(DEMO_APPLICATIONS.length);
      expect(sqls.filter(s => /INSERT INTO user_insights/.test(s))).toHaveLength(DEMO_PATTERNS.length);
    });

    it('runs the seeding inside one transaction and commits', async () => {
      await request(app).post('/auth/demo');

      const sqls = mockClient.query.mock.calls.map(c => c[0]);
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls[sqls.length - 1]).toBe('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back and returns 500 if seeding fails part-way', async () => {
      mockClient.query.mockImplementation(async (sql) => {
        if (/INSERT INTO applications/.test(sql)) throw new Error('db exploded');
        if (/RETURNING id/.test(sql)) return { rows: [{ id: 'pattern-id' }] };
        return { rows: [] };
      });

      const res = await request(app).post('/auth/demo');

      expect(res.status).toBe(500);
      const sqls = mockClient.query.mock.calls.map(c => c[0]);
      expect(sqls).toContain('ROLLBACK');
      expect(sqls).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('deletes expired demo users before creating a new one', async () => {
      await request(app).post('/auth/demo');

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM users/);
      expect(sql).toMatch(/is_demo/);
      expect(params).toEqual([4]);
    });
  });
});

describe('demo sample data', () => {
  it('fills every tracker column so the board is never empty', () => {
    const outcomes = new Set(DEMO_APPLICATIONS.map(a => a.outcome));
    expect([...outcomes].sort()).toEqual(['ghosted', 'interview', 'offer', 'pending', 'rejected']);
  });

  it('keeps synthetic patterns out of the real pipeline namespace', () => {
    DEMO_PATTERNS.forEach(p => expect(p.roleBucket).toMatch(/^demo_/));
  });
});
