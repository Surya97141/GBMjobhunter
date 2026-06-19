const axios  = require('axios');
const http   = require('http');
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { standardLimiter, resumeUploadLimiter } = require('../middleware/rateLimiter.middleware');

const router = Router();

// ── JSON relay ───────────────────────────────────────────────────────────────
// Forwards requests where express.json() has already parsed the body.
// Do NOT use this for multipart/form-data — use streamForward instead.
function forward(baseUrl) {
  return async (req, res) => {
    try {
      const upstream = await axios({
        method:  req.method,
        url:     `${baseUrl}${req.originalUrl}`,
        headers: {
          ...req.headers,
          host:             undefined, // don't forward client's host header
          'content-length': undefined, // let axios recalculate after body parse
        },
        data:           ['GET', 'DELETE', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : req.body,
        params:         undefined, // already encoded in req.originalUrl
        validateStatus: () => true, // never throw on HTTP error codes
        timeout:        9000,
      });

      res.status(upstream.status).json(upstream.data);
    } catch (err) {
      console.error(`Proxy error → ${baseUrl}:`, err.message);
      res.status(502).json({ status: 'error', message: 'Upstream service unavailable' });
    }
  };
}

// ── Raw-stream relay ──────────────────────────────────────────────────────────
// Pipes the raw HTTP request stream directly to the upstream service.
// Required for multipart/form-data (file uploads) because express.json() does
// not read that body, so req.body is empty — the data lives in the raw stream.
function streamForward(baseUrl) {
  return (req, res) => {
    const parsed  = new URL(`${baseUrl}${req.originalUrl}`);
    const options = {
      hostname: parsed.hostname,
      port:     parseInt(parsed.port, 10),
      path:     parsed.pathname + (parsed.search || ''),
      method:   req.method,
      headers: {
        ...req.headers,
        host: parsed.host, // upstream host, not the client's
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        try {
          res.status(proxyRes.statusCode).json(JSON.parse(body));
        } catch {
          res.status(proxyRes.statusCode).send(body);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Stream proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ status: 'error', message: 'Upstream service unavailable' });
      }
    });

    req.pipe(proxyReq);
  };
}

// ── Public auth routes (no JWT required) ─────────────────────────────────────
router.use('/auth', standardLimiter, forward(process.env.USER_SERVICE_URL));

// ── Resume upload — raw stream proxy because body is multipart/form-data ─────
router.post(
  '/users/me/resume',
  requireAuth,
  resumeUploadLimiter,
  streamForward(process.env.USER_SERVICE_URL)
);

// ── Protected user routes ─────────────────────────────────────────────────────
router.use('/users', requireAuth, standardLimiter, forward(process.env.USER_SERVICE_URL));

// ── Protected jobs routes ─────────────────────────────────────────────────────
router.use('/applications', requireAuth, standardLimiter, forward(process.env.JOBS_SERVICE_URL));
router.use('/jobs',         requireAuth, standardLimiter, forward(process.env.JOBS_SERVICE_URL));

// ── Protected opportunity routes ──────────────────────────────────────────────
router.use('/opportunities', requireAuth, standardLimiter, forward(process.env.OPPORTUNITY_SERVICE_URL));

// ── Protected agent routes ────────────────────────────────────────────────────
// Standard rate limit (100 req/min) covers total throughput.
// Per-user Tier 3 quota (5 calls/day) is enforced inside the agent service itself.
router.use('/agent', requireAuth, standardLimiter, forward(process.env.AGENT_SERVICE_URL));

module.exports = router;
