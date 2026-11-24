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
  return { standardLimiter: pass, resumeUploadLimiter: pass };
});
jest.mock('../utils/redis', () => ({}));

// The gateway relays requests with axios — mock it so no network is used.
jest.mock('axios');

const app = require('../../index');

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
