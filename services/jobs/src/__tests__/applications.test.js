process.env.DATABASE_URL = 'postgres://mock';
process.env.REDIS_URL    = 'redis://mock'; // checked at startup; BullMQ is mocked below

const request = require('supertest');
const app     = require('../../index');

// ── Mock all external dependencies ───────────────────────────────────────────

jest.mock('../../src/db/applications.db', () => ({
  createApplication:      jest.fn(),
  getApplicationsByUserId:jest.fn(),
  updateOutcome:          jest.fn(),
}));

jest.mock('../../src/db/companies.db', () => ({
  findOrCreateCompany: jest.fn(),
}));

jest.mock('../../src/db/users.db', () => ({
  getResumeByUserId: jest.fn(),
}));

// BullMQ producer talks to Redis. Mock it so tests don't need a real Redis.
jest.mock('../../src/queues/producer', () => ({
  publishApplicationLogged: jest.fn().mockResolvedValue(undefined),
  publishOutcomeUpdated:    jest.fn().mockResolvedValue(undefined),
}));

const applicationsDb = require('../../src/db/applications.db');
const companiesDb    = require('../../src/db/companies.db');
const usersDb        = require('../../src/db/users.db');

// Gateway sets x-user-id after verifying the JWT. Tests send it directly —
// the jobs service trusts this header (auth is the gateway's responsibility).
const AUTH_HEADER = { 'x-user-id': 'user-uuid-1' };

const VALID_BODY = {
  companyName: 'Stripe',
  roleTitle:   'Senior Frontend Engineer',
  jdText:      'We are looking for an experienced frontend engineer with React and TypeScript.',
};

// ────────────────────────────────────────────────────────────────────────────
describe('POST /applications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with application and atsScore on valid input', async () => {
    usersDb.getResumeByUserId.mockResolvedValue(null); // no resume → atsScore = null
    companiesDb.findOrCreateCompany.mockResolvedValue({ id: 'company-uuid-1', name: 'Stripe' });
    applicationsDb.createApplication.mockResolvedValue({
      id:         'app-uuid-1',
      user_id:    'user-uuid-1',
      company_id: 'company-uuid-1',
      role_title: 'Senior Frontend Engineer',
      outcome:    'pending',
      applied_at: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/applications')
      .set(AUTH_HEADER)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.application.role_title).toBe('Senior Frontend Engineer');
  });

  it('returns 400 when companyName is missing', async () => {
    const res = await request(app)
      .post('/applications')
      .set(AUTH_HEADER)
      .send({ roleTitle: 'Engineer', jdText: VALID_BODY.jdText });

    expect(res.status).toBe(400);
  });

  it('returns 400 when jdText is shorter than 10 characters', async () => {
    const res = await request(app)
      .post('/applications')
      .set(AUTH_HEADER)
      .send({ companyName: 'Stripe', roleTitle: 'Engineer', jdText: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/applications')
      .set(AUTH_HEADER)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /applications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with applications array', async () => {
    applicationsDb.getApplicationsByUserId.mockResolvedValue([
      { id: 'app-1', role_title: 'Engineer', outcome: 'pending' },
      { id: 'app-2', role_title: 'Designer', outcome: 'interview' },
    ]);

    const res = await request(app)
      .get('/applications')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data.applications).toHaveLength(2);
  });

  it('returns 200 with empty array when user has no applications', async () => {
    applicationsDb.getApplicationsByUserId.mockResolvedValue([]);

    const res = await request(app)
      .get('/applications')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data.applications).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('PATCH /applications/:id/outcome', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with updated application on valid outcome', async () => {
    applicationsDb.updateOutcome.mockResolvedValue({
      id:      'app-uuid-1',
      outcome: 'interview',
      jd_fingerprint_hash: 'abc123',
      response_days: 3,
    });

    const res = await request(app)
      .put('/applications/app-uuid-1/outcome')
      .set(AUTH_HEADER)
      .send({ outcome: 'interview', responseDays: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data.application.outcome).toBe('interview');
  });

  it('returns 404 when application does not belong to the user', async () => {
    // updateOutcome returns null when the row doesn't exist or userId doesn't match
    applicationsDb.updateOutcome.mockResolvedValue(null);

    const res = await request(app)
      .put('/applications/nonexistent-id/outcome')
      .set(AUTH_HEADER)
      .send({ outcome: 'rejected' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when outcome is not a valid enum value', async () => {
    const res = await request(app)
      .put('/applications/app-uuid-1/outcome')
      .set(AUTH_HEADER)
      .send({ outcome: 'hired' }); // not in the enum

    expect(res.status).toBe(400);
  });
});
