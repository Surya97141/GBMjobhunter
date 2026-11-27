process.env.REDIS_URL = 'redis://mock';

const request = require('supertest');

jest.mock('../services/modelRouter.service', () => ({ callModel: jest.fn() }));
jest.mock('../db/lookup.db', () => ({
  getCompanySignals: jest.fn(),
  getUserSkills:     jest.fn(),
  getUserAiContext:  jest.fn(),
}));
// Demo quotas use Redis; replaced with an in-memory counter.
const mockCounters = new Map();
jest.mock('../utils/redis', () => ({
  incr:   jest.fn(async (k) => { const n = (mockCounters.get(k) ?? 0) + 1; mockCounters.set(k, n); return n; }),
  expire: jest.fn(async () => 1),
}));
// Anthropic SDK: typed error classes plus a controllable messages.create.
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  const create = jest.fn();
  function Anthropic(opts) { Anthropic.lastOptions = opts; this.messages = { create }; }
  Object.assign(Anthropic, {
    APIError, AuthenticationError, PermissionDeniedError, RateLimitError,
    InternalServerError, APIConnectionError, APIConnectionTimeoutError, create,
  });
  return Anthropic;
});

const app = require('../../index');
const Anthropic = require('@anthropic-ai/sdk');
const { callModel } = require('../services/modelRouter.service');
const { getUserAiContext, getUserSkills } = require('../db/lookup.db');

const AUTH = { 'x-user-id': 'user-uuid-1' };
const KEY  = 'sk-test-THIS-IS-A-SECRET-KEY-1234567890';
const RECS = [
  { skill: 'typescript', level: 'intermediate', domain: 'frontend', buildsOn: ['javascript'] },
  { skill: 'node.js',    level: 'intermediate', domain: 'backend',  buildsOn: ['javascript'] },
];
const GUIDANCE_JSON = JSON.stringify({
  summary: 'Both build directly on your JavaScript. See https://example.com/course for more.',
  items: [
    { skill: 'TypeScript', explanation: 'Adds types to the JavaScript you know. Try typing a small API client. www.spam.example' },
    { skill: 'Kubernetes', explanation: 'Invented skill that was not recommended.' },
  ],
});

let fetchMock;
let logs;
const okChat = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockCounters.clear();
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_DEMO_DAILY_LIMIT_PER_USER;
  delete process.env.AI_DEMO_DAILY_LIMIT_TOTAL;
  delete process.env.AI_ENABLE_ANTHROPIC;
  getUserAiContext.mockResolvedValue({ skills: ['JavaScript', 'React'], targetRole: 'Frontend Developer' });
  getUserSkills.mockResolvedValue(['JavaScript']);
  fetchMock = jest.fn().mockResolvedValue(okChat(GUIDANCE_JSON));
  global.fetch = fetchMock;
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => logs.push(args.map(String).join(' ')));
  }
});
afterEach(() => jest.restoreAllMocks());

// The key must never come back to the client or reach the logs.
function expectNoKeyLeak(res) {
  expect(JSON.stringify(res.body)).not.toContain(KEY);
  expect(logs.join('\n')).not.toContain(KEY);
}

const guidance = (ai, extra = {}) =>
  request(app).post('/agent/ai/opportunity-guidance').set(AUTH).send({ ai, recommendations: RECS, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /agent/ai/status', () => {
  it('reports demo mode unavailable when GROQ_API_KEY is missing', async () => {
    const res = await request(app).get('/agent/ai/status');
    expect(res.status).toBe(200);
    expect(res.body.data.demo.available).toBe(false);
    expect(res.body.data.byok.providers.map(p => p.id)).toEqual(['groq', 'openai']);
  });

  it('lists Anthropic only when the operator enables it', async () => {
    process.env.AI_ENABLE_ANTHROPIC = 'true';
    const res = await request(app).get('/agent/ai/status');
    expect(res.body.data.byok.providers.map(p => p.id)).toEqual(['groq', 'openai', 'anthropic']);
  });

  it('reports demo mode available without exposing the key', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    const res = await request(app).get('/agent/ai/status');
    expect(res.body.data.demo.available).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('gsk_SHARED_DEMO_SECRET');
  });
});

describe('demo mode', () => {
  it('returns not_configured and calls no provider when GROQ_API_KEY is missing', async () => {
    const res = await guidance({ mode: 'demo' });
    expect(res.body).toEqual({ success: false, error: 'not_configured', message: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the shared Groq key from the environment', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    const res = await guidance({ mode: 'demo' });
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('groq');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer gsk_SHARED_DEMO_SECRET_0000000000');
    expect(JSON.stringify(res.body)).not.toContain('gsk_SHARED_DEMO_SECRET');
  });

  it('enforces the per-user daily limit', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    process.env.AI_DEMO_DAILY_LIMIT_PER_USER = '2';
    await guidance({ mode: 'demo' });
    await guidance({ mode: 'demo' });
    const third = await guidance({ mode: 'demo' });
    expect(third.body.error).toBe('quota_exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('enforces the limit across all users (demo-wide capacity)', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    process.env.AI_DEMO_DAILY_LIMIT_TOTAL = '2';
    const asUser = (id) => request(app).post('/agent/ai/opportunity-guidance')
      .set({ 'x-user-id': id }).send({ ai: { mode: 'demo' }, recommendations: RECS });

    expect((await asUser('user-a')).body.success).toBe(true);
    expect((await asUser('user-b')).body.success).toBe(true);
    // A third, different user is under their own per-user limit but over the total.
    const third = await asUser('user-c');
    expect(third.body).toEqual({ success: false, error: 'demo_capacity', message: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(third.body)).not.toContain('gsk_SHARED_DEMO_SECRET');
  });

  it('checks the per-user limit first, so a user over it does not use up shared capacity', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    process.env.AI_DEMO_DAILY_LIMIT_PER_USER = '1';
    process.env.AI_DEMO_DAILY_LIMIT_TOTAL = '2';
    const asUser = (id) => request(app).post('/agent/ai/opportunity-guidance')
      .set({ 'x-user-id': id }).send({ ai: { mode: 'demo' }, recommendations: RECS });

    expect((await asUser('user-a')).body.success).toBe(true);
    expect((await asUser('user-a')).body.error).toBe('quota_exceeded');
    expect((await asUser('user-a')).body.error).toBe('quota_exceeded');
    // user-a's rejected requests did not count toward the total of 2.
    expect((await asUser('user-b')).body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies the demo-wide limit to the Hidden Curriculum Decoder too', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    process.env.AI_DEMO_DAILY_LIMIT_TOTAL = '1';
    fetchMock.mockResolvedValue(okChat('An explanation.'));
    const decode = (id) => request(app).post('/agent/explain-hiring-process')
      .set({ 'x-user-id': id }).send({ topic: 'behavioral round', ai: { mode: 'demo' } });
    expect((await decode('user-a')).body.success).toBe(true);
    const res = await decode('user-b');
    expect(res.body.error).toBe('demo_capacity');
  });

  it('fails closed when the quota store is unavailable', async () => {
    process.env.GROQ_API_KEY = 'gsk_SHARED_DEMO_SECRET_0000000000';
    require('../utils/redis').incr.mockRejectedValueOnce(new Error('redis down'));
    const res = await guidance({ mode: 'demo' });
    expect(res.body.error).toBe('quota_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('bring-your-own-key mode', () => {
  it('calls OpenAI with the user key and never returns or logs it', async () => {
    const res = await guidance({ mode: 'byok', provider: 'openai', apiKey: KEY });
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('openai');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expectNoKeyLeak(res);
  });

  it('rejects Anthropic while it is disabled (the default) without calling the SDK', async () => {
    const res = await guidance({ mode: 'byok', provider: 'anthropic', apiKey: KEY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('provider_disabled');
    expect(Anthropic.create).not.toHaveBeenCalled();
    expect(Anthropic.lastOptions).toBeUndefined();
    expectNoKeyLeak(res);
  });

  it('calls Anthropic through the SDK with the user key and the route\'s max_tokens when enabled', async () => {
    process.env.AI_ENABLE_ANTHROPIC = 'true';
    Anthropic.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: GUIDANCE_JSON }] });
    const res = await guidance({ mode: 'byok', provider: 'anthropic', apiKey: KEY });
    expect(res.body.success).toBe(true);
    expect(Anthropic.lastOptions.apiKey).toBe(KEY);
    const [params, options] = Anthropic.create.mock.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(1200);
    expect(params).not.toHaveProperty('fallbacks');
    expect(options).toBeUndefined(); // no hand-added beta headers
    expectNoKeyLeak(res);
  });

  it('reports a reply cut off at max_tokens as bad_output', async () => {
    process.env.AI_ENABLE_ANTHROPIC = 'true';
    Anthropic.create.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary": "cut' }] });
    const res = await guidance({ mode: 'byok', provider: 'anthropic', apiKey: KEY });
    expect(res.body.error).toBe('bad_output');
  });

  it('maps a rejected key to invalid_key without echoing the provider message', async () => {
    // OpenAI-style providers echo part of the key in 401 bodies; it must not leak.
    fetchMock.mockResolvedValue({
      ok: false, status: 401,
      arrayBuffer: async () => Buffer.from(`{"error":{"message":"Incorrect API key provided: ${KEY}"}}`),
      json: async () => ({ error: { message: `Incorrect API key provided: ${KEY}` } }),
    });
    const res = await guidance({ mode: 'byok', provider: 'groq', apiKey: KEY });
    expect(res.body.error).toBe('invalid_key');
    expectNoKeyLeak(res);
    expect(logs.join('\n')).not.toContain('Incorrect API key');
  });

  it('maps an Anthropic authentication error to invalid_key without leaking', async () => {
    process.env.AI_ENABLE_ANTHROPIC = 'true';
    Anthropic.create.mockRejectedValue(new Anthropic.AuthenticationError(401, `invalid x-api-key ${KEY}`));
    const res = await guidance({ mode: 'byok', provider: 'anthropic', apiKey: KEY });
    expect(res.body.error).toBe('invalid_key');
    expectNoKeyLeak(res);
  });

  it('reports a model refusal instead of empty text', async () => {
    process.env.AI_ENABLE_ANTHROPIC = 'true';
    Anthropic.create.mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const res = await guidance({ mode: 'byok', provider: 'anthropic', apiKey: KEY });
    expect(res.body.error).toBe('refused');
  });

  it('rejects an arbitrary base URL or model override', async () => {
    for (const ai of [
      { mode: 'byok', provider: 'openai', apiKey: KEY, baseUrl: 'https://evil.example/v1' },
      { mode: 'byok', provider: 'openai', apiKey: KEY, model: 'anything' },
      { mode: 'byok', provider: 'mistral', apiKey: KEY },
    ]) {
      const res = await guidance(ai);
      expect(res.status).toBe(400);
      expectNoKeyLeak(res);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed key without echoing it', async () => {
    const res = await guidance({ mode: 'byok', provider: 'openai', apiKey: 'has spaces in it but is long enough' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('has spaces');
  });
});

describe('grounding of opportunity guidance', () => {
  it('sends only resume skills, target role and the recommendations to the provider', async () => {
    await guidance({ mode: 'byok', provider: 'openai', apiKey: KEY });
    const sent = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content);
    expect(Object.keys(sent).sort()).toEqual(['recommendations', 'resumeSkills', 'targetRole']);
    expect(sent.resumeSkills).toEqual(['JavaScript', 'React']);
    expect(sent.targetRole).toBe('Frontend Developer');
  });

  it('drops skills that were not recommended and strips links', async () => {
    const res = await guidance({ mode: 'byok', provider: 'openai', apiKey: KEY });
    expect(res.body.guidance.items).toEqual([
      { skill: 'typescript', explanation: 'Adds types to the JavaScript you know. Try typing a small API client.' },
    ]);
    expect(res.body.guidance.summary).not.toMatch(/https?:|example\.com/);
  });

  it('returns bad_output when the reply is not usable JSON', async () => {
    fetchMock.mockResolvedValue(okChat('Sure! Here are some thoughts without JSON.'));
    const res = await guidance({ mode: 'byok', provider: 'openai', apiKey: KEY });
    expect(res.body.error).toBe('bad_output');
  });

  it('rejects requests without recommendations', async () => {
    const res = await request(app).post('/agent/ai/opportunity-guidance').set(AUTH)
      .send({ ai: { mode: 'demo' }, recommendations: [] });
    expect(res.status).toBe(400);
  });

  it('requires the gateway-injected user id', async () => {
    const res = await request(app).post('/agent/ai/opportunity-guidance')
      .send({ ai: { mode: 'demo' }, recommendations: RECS });
    expect(res.status).toBe(401);
  });
});

describe('POST /agent/explain-hiring-process with an AI mode', () => {
  it('uses the selected provider when ai is given', async () => {
    fetchMock.mockResolvedValue(okChat('A plain explanation.'));
    const res = await request(app).post('/agent/explain-hiring-process').set(AUTH)
      .send({ topic: 'behavioral round', ai: { mode: 'byok', provider: 'groq', apiKey: KEY } });
    expect(res.body).toEqual(expect.objectContaining({ success: true, text: 'A plain explanation.', provider: 'groq' }));
    expect(callModel).not.toHaveBeenCalled();
    expectNoKeyLeak(res);
  });

  it('keeps the original server-configured path when ai is absent', async () => {
    callModel.mockResolvedValue({ success: true, data: {} });
    await request(app).post('/agent/explain-hiring-process').set(AUTH).send({ topic: 'behavioral round' });
    expect(callModel).toHaveBeenCalledWith('tier2', 'curriculum_explain', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
