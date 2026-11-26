process.env.REDIS_URL = 'redis://mock'; // checked at startup; Redis users are mocked below

const request = require('supertest');

// modelRouter (Redis + LLM SDKs) and lookup.db (Postgres) are mocked, so no
// external services are needed.
jest.mock('../services/modelRouter.service', () => ({ callModel: jest.fn() }));
jest.mock('../db/lookup.db', () => ({
  getCompanySignals: jest.fn(),
  getUserSkills:     jest.fn(),
}));

const app = require('../../index');
const { callModel } = require('../services/modelRouter.service');
const { getCompanySignals, getUserSkills } = require('../db/lookup.db');

const AUTH = { 'x-user-id': 'user-uuid-1' };
const MODEL_OK = { success: true, data: { choices: [{ message: { content: 'Hello' } }] } };

// Any unhandled rejection during a test fails it.
const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
beforeAll(() => process.on('unhandledRejection', onUnhandled));
afterAll(() => process.off('unhandledRejection', onUnhandled));

let consoleError;
beforeEach(() => {
  jest.clearAllMocks();
  unhandled.length = 0;
  callModel.mockResolvedValue(MODEL_OK);
  getCompanySignals.mockResolvedValue(null);
  getUserSkills.mockResolvedValue(['React', 'Node.js']);
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  // Let any stray promise settle before checking.
  await new Promise(r => setImmediate(r));
  expect(unhandled).toEqual([]);
  consoleError.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /agent/generate-cover-letter', () => {
  const url = '/agent/generate-cover-letter';
  const valid = { role: 'Engineer', company: 'Acme', jobDescription: 'Build things.' };

  it('passes the model result through on a valid request', async () => {
    const res = await request(app).post(url).send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MODEL_OK);
    expect(callModel).toHaveBeenCalledWith('tier2', 'cover_letter_generate', expect.objectContaining({
      messages: [{ role: 'user', content: expect.stringContaining('Job description:\nBuild things.') }],
    }));
  });

  it('accepts an empty jobDescription (what the popup sends when there is no JD)', async () => {
    const res = await request(app).post(url).send({ ...valid, jobDescription: '' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing role',               { company: 'Acme' }],
    ['empty company',              { role: 'Engineer', company: '' }],
    ['non-string role',            { role: 42, company: 'Acme' }],
    ['object company',             { role: 'Engineer', company: { $ne: 1 } }],
    ['non-string jobDescription',  { ...valid, jobDescription: 12345 }],
    ['array body',                 [valid]],
  ])('returns 400 for %s', async (_name, body) => {
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 'error', message: 'role and company are required' });
    expect(callModel).not.toHaveBeenCalled();
  });

  it('returns a generic 500 without internal details when the model call throws', async () => {
    callModel.mockRejectedValue(new Error('secret upstream detail sk-123'));
    const res = await request(app).post(url).send(valid);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'internal_error', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /agent/generate-outreach', () => {
  const url = '/agent/generate-outreach';
  const valid = { companyName: 'Acme', roleTitle: 'Engineer', jdText: 'JD text', contactName: 'Sam' };

  it('passes the model result through on a valid request', async () => {
    const res = await request(app).post(url).set(AUTH).send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MODEL_OK);
    const content = callModel.mock.calls[0][2].messages[0].content;
    expect(content).toContain('Company: Acme');
    expect(content).toContain('Contact name: Sam');
    expect(content).toContain("Applicant's skills: React, Node.js");
  });

  it('still works when the supplementary lookups fail', async () => {
    getCompanySignals.mockRejectedValue(new Error('db down'));
    getUserSkills.mockRejectedValue(new Error('db down'));
    const res = await request(app).post(url).set(AUTH).send(valid);
    expect(res.status).toBe(200);
  });

  it('returns 401 without x-user-id', async () => {
    const res = await request(app).post(url).send(valid);
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing companyName',   { roleTitle: 'Engineer' }],
    ['non-string roleTitle',  { companyName: 'Acme', roleTitle: ['Engineer'] }],
    // Previously crashed on jdText.slice() outside any try/catch → unhandled rejection, no response.
    ['non-string jdText',     { ...valid, jdText: 12345 }],
    ['non-string contactRole', { ...valid, contactRole: { x: 1 } }],
  ])('returns 400 for %s', async (_name, body) => {
    const res = await request(app).post(url).set(AUTH).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 'error', message: 'companyName and roleTitle are required' });
    expect(callModel).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when the model call throws', async () => {
    callModel.mockRejectedValue(new Error('internal stack detail'));
    const res = await request(app).post(url).set(AUTH).send(valid);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /agent/explain-hiring-process', () => {
  const url = '/agent/explain-hiring-process';

  it('passes the model result through for a known topic', async () => {
    const res = await request(app).post(url).set(AUTH).send({ topic: 'behavioral round' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MODEL_OK);
  });

  it.each([
    ['missing topic',  {}],
    ['unknown topic',  { topic: 'salary negotiation' }],
    ['non-string topic', { topic: ['behavioral round'] }],
  ])('returns 400 for %s', async (_name, body) => {
    const res = await request(app).post(url).set(AUTH).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^topic is required and must be one of:/);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when the model call throws', async () => {
    callModel.mockRejectedValue(new Error('boom'));
    const res = await request(app).post(url).set(AUTH).send({ topic: 'behavioral round' });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('body parsing errors', () => {
  it('returns a JSON 400 (not an HTML stack trace) for malformed JSON', async () => {
    const res = await request(app)
      .post('/agent/generate-cover-letter')
      .set('Content-Type', 'application/json')
      .send('{"role": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ status: 'error', message: 'Request body must be valid JSON' });
  });
});
