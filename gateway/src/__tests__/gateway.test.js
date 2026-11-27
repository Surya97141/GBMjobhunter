// Env vars must be set BEFORE requiring the app: index.js validates them at
// load time, and proxy.routes.js captures the service URLs when it loads.
process.env.JWT_SECRET             = 'test-secret-for-jest';
process.env.USER_SERVICE_URL       = 'http://user.test';
process.env.JOBS_SERVICE_URL       = 'http://jobs.test';
process.env.OPPORTUNITY_SERVICE_URL = 'http://opp.test';
process.env.AGENT_SERVICE_URL      = 'http://agent.test';
process.env.REDIS_URL              = 'redis://mock';

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');

// ── Mocks ────────────────────────────────────────────────────────────────────
// Redis only backs the rate limiter, so replace the limiter with a pass-through.
// Rate limiting itself is express-rate-limit's job; we test our routing here.
jest.mock('../middleware/rateLimiter.middleware', () => {
  const pass = (_req, _res, next) => next();
  // aiLimiter is a spy so tests can check which routes it is applied to.
  return { standardLimiter: pass, resumeUploadLimiter: pass, demoLimiter: pass, aiLimiter: jest.fn(pass) };
});
jest.mock('../utils/redis', () => ({}));

// The gateway relays requests with axios — mock it so no network is used.
jest.mock('axios');

const app = require('../../index');
const { aiLimiter } = require('../middleware/rateLimiter.middleware');

const sign = (opts = {}, secret = process.env.JWT_SECRET) =>
  jwt.sign({ sub: 'user-uuid-1', email: 'a@b.com' }, secret, opts);

beforeEach(() => {
  jest.clearAllMocks();
  axios.mockResolvedValue({ status: 200, data: { status: 'success', data: [] } });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 without any token', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('JWT enforcement on protected routes', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).get('/applications');
    expect(res.status).toBe(401);
    expect(axios).not.toHaveBeenCalled();
  });

  it('returns 401 when the header is not a Bearer token', async () => {
    const res = await request(app).get('/applications').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const res = await request(app)
      .get('/applications')
      .set('Authorization', `Bearer ${sign({}, 'some-other-secret')}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid token');
  });

  it('returns 401 with "Token expired" for an expired token', async () => {
    const res = await request(app)
      .get('/applications')
      .set('Authorization', `Bearer ${sign({ expiresIn: -10 })}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token expired');
  });

  it.each(['/users/me', '/applications', '/jobs', '/opportunities', '/agent/call'])(
    'requires a token for %s',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  );
});

describe('Routing to upstream services', () => {
  it.each([
    ['/applications', 'http://jobs.test'],
    ['/jobs',         'http://jobs.test'],
    ['/users/me',     'http://user.test'],
    ['/opportunities','http://opp.test'],
    ['/agent/call',   'http://agent.test'],
  ])('routes %s to %s', async (path, base) => {
    const res = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${sign()}`);

    expect(res.status).toBe(200);
    expect(axios.mock.calls[0][0].url).toBe(`${base}${path}`);
  });

  it('injects x-user-id and x-user-email from the verified token', async () => {
    await request(app).get('/applications').set('Authorization', `Bearer ${sign()}`);

    const { headers } = axios.mock.calls[0][0];
    expect(headers['x-user-id']).toBe('user-uuid-1');
    expect(headers['x-user-email']).toBe('a@b.com');
  });

  // Services trust x-user-id blindly, so a client must never be able to pick
  // its own identity: the gateway has to overwrite any value it sends.
  it('overwrites a spoofed x-user-id header with the one from the token', async () => {
    await request(app)
      .get('/applications')
      .set('Authorization', `Bearer ${sign()}`)
      .set('x-user-id', 'someone-elses-id');

    expect(axios.mock.calls[0][0].headers['x-user-id']).toBe('user-uuid-1');
  });

  it('passes the upstream status code and body back to the client', async () => {
    axios.mockResolvedValue({ status: 404, data: { status: 'error', message: 'nope' } });

    const res = await request(app).get('/applications').set('Authorization', `Bearer ${sign()}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('nope');
  });

  it('gives agent (AI) requests a longer upstream timeout than other routes', async () => {
    await request(app).get('/applications').set('Authorization', `Bearer ${sign()}`);
    await request(app).post('/agent/ai/opportunity-guidance').set('Authorization', `Bearer ${sign()}`).send({});
    expect(axios.mock.calls[0][0].timeout).toBe(9000);
    expect(axios.mock.calls[1][0].timeout).toBe(30000);
  });

  it('relays the AI request body to the agent service unchanged', async () => {
    const body = { ai: { mode: 'byok', provider: 'openai', apiKey: 'sk-test-relay-key-1234567890' }, recommendations: [] };
    await request(app).post('/agent/ai/opportunity-guidance').set('Authorization', `Bearer ${sign()}`).send(body);
    expect(axios.mock.calls[0][0].url).toBe('http://agent.test/agent/ai/opportunity-guidance');
    expect(axios.mock.calls[0][0].data).toEqual(body);
  });

  it('returns 502 when the upstream service is unreachable', async () => {
    axios.mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/applications').set('Authorization', `Bearer ${sign()}`);

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Upstream service unavailable');
  });
});

describe('Public auth routes', () => {
  it('forwards POST /auth/login to the user service without a token', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });

    expect(res.status).toBe(200);
    const call = axios.mock.calls[0][0];
    expect(call.url).toBe('http://user.test/auth/login');
    expect(call.method).toBe('POST');
    expect(call.data).toEqual({ email: 'a@b.com', password: 'x' });
  });
});

describe('Demo signup route', () => {
  it('forwards POST /auth/demo to the user service without a token', async () => {
    axios.mockResolvedValue({ status: 201, data: { status: 'success', data: { token: 't' } } });

    const res = await request(app).post('/auth/demo');

    expect(res.status).toBe(201);
    expect(axios.mock.calls[0][0].url).toBe('http://user.test/auth/demo');
  });
});

describe('AI rate limit scoping', () => {
  const auth = () => `Bearer ${sign()}`;

  it.each([
    '/agent/ai/opportunity-guidance',
    '/agent/ai/opportunity-plan',
    '/agent/ai/opportunity-followup',
    '/agent/explain-hiring-process',
    '/agent/generate-cover-letter',
    '/agent/generate-outreach',
  ])('applies the AI limit to the model call POST %s', async (path) => {
    await request(app).post(path).set('Authorization', auth()).send({});
    expect(aiLimiter).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  it('does not apply the AI limit to the AI status check', async () => {
    const res = await request(app).get('/agent/ai/status').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(aiLimiter).not.toHaveBeenCalled();
    expect(axios.mock.calls[0][0].url).toBe('http://agent.test/agent/ai/status');
  });

  it('does not apply the AI limit to the agent health check', async () => {
    await request(app).get('/agent/health').set('Authorization', auth());
    expect(aiLimiter).not.toHaveBeenCalled();
  });

  it('does not apply the AI limit to non-model routes elsewhere', async () => {
    await request(app).get('/applications').set('Authorization', auth());
    await request(app).get('/opportunities').set('Authorization', auth());
    expect(aiLimiter).not.toHaveBeenCalled();
  });

  it('still blocks a model call when the AI limit rejects it', async () => {
    aiLimiter.mockImplementationOnce((_req, res) => res.status(429).json({ success: false, error: 'rate_limited' }));
    const res = await request(app).post('/agent/ai/opportunity-guidance').set('Authorization', auth()).send({});
    expect(res.status).toBe(429);
    expect(axios).not.toHaveBeenCalled();
  });
});

describe('Malformed request bodies', () => {
  // A fake key left unquoted: for this kind of syntax error, Node's JSON.parse
  // message quotes the surrounding body text ('Unexpected token 's', ..."apiKey":
  // sk-FAKEKEY"... is not valid JSON'), so a leak of the message leaks the key.
  const FAKE_KEY = 'sk-FAKEKEYFRAGMENT-0123456789abcdef';
  // Node shows only ~10 characters of context, so check for a short fragment.
  const FRAGMENT = 'FAKEKEY';
  const BROKEN   = `{"ai":{"mode":"byok","provider":"openai","apiKey": ${FAKE_KEY}}}`;

  // Express's default error handler is silent when env is 'test' (Jest's
  // default). Run these as 'development', where it would log err.stack and
  // return it, so the tests fail if the gateway's own handler is ever removed.
  let previousEnv;
  beforeAll(() => { previousEnv = app.get('env'); app.set('env', 'development'); });
  afterAll(() => { app.set('env', previousEnv); });

  function captureLogs() {
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(level =>
      jest.spyOn(console, level).mockImplementation((...args) => {
        lines.push(args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
      }));
    spies.push(jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    }));
    // Restore only these spies (restoreAllMocks would also reset the aiLimiter spy).
    return { lines, restore: () => spies.forEach(s => s.mockRestore()) };
  }

  it('returns a fixed 400 and never logs or echoes the body (AI route)', async () => {
    const logs = captureLogs();
    try {
      const res = await request(app)
        .post('/agent/ai/opportunity-guidance')
        .set('Authorization', `Bearer ${sign()}`)
        .set('Content-Type', 'application/json')
        .send(BROKEN);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ status: 'error', message: 'Request body must be valid JSON' });
      expect(res.text).not.toContain(FRAGMENT);
      expect(res.text).not.toContain('apiKey');
      expect(logs.lines.join('\n')).not.toContain(FRAGMENT);
      expect(axios).not.toHaveBeenCalled();
    } finally {
      logs.restore();
    }
  });

  it('handles a malformed body on a public route the same way', async () => {
    const logs = captureLogs();
    try {
      const res = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send(`{"email":"a@b.com","password": ${FAKE_KEY}}`);
      expect(res.status).toBe(400);
      expect(res.text).not.toContain(FRAGMENT);
      expect(logs.lines.join('\n')).not.toContain(FRAGMENT);
    } finally {
      logs.restore();
    }
  });
});

describe('Fallbacks and CORS', () => {
  it('returns 404 JSON for an unknown route', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
  });

  it('allows requests from a chrome-extension origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'chrome-extension://abcdef');
    expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');
  });

  it('allows the default web dev origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not grant CORS access to an unlisted origin', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
