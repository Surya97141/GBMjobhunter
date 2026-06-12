const { createProxyMiddleware } = require('http-proxy-middleware');
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { standardLimiter, resumeUploadLimiter } = require('../middleware/rateLimiter.middleware');

const router = Router();

function proxyTo(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      error: (err, req, res) => {
        console.error(`Proxy error to ${target}:`, err.message);
        res.status(502).json({ status: 'error', message: 'Upstream service unavailable' });
      },
    },
  });
}

// ── Public auth routes (no JWT required) ──────────────────────────────────────
router.use(
  '/auth',
  standardLimiter,
  proxyTo(process.env.USER_SERVICE_URL)
);

// ── Protected user routes ─────────────────────────────────────────────────────
router.post(
  '/users/me/resume',
  requireAuth,
  resumeUploadLimiter,
  proxyTo(process.env.USER_SERVICE_URL)
);

router.use(
  '/users',
  requireAuth,
  standardLimiter,
  proxyTo(process.env.USER_SERVICE_URL)
);

// ── Protected jobs routes ─────────────────────────────────────────────────────
router.use(
  '/applications',
  requireAuth,
  standardLimiter,
  proxyTo(process.env.JOBS_SERVICE_URL)
);

router.use(
  '/jobs',
  requireAuth,
  standardLimiter,
  proxyTo(process.env.JOBS_SERVICE_URL)
);

// ── Protected opportunity routes ──────────────────────────────────────────────
router.use(
  '/opportunities',
  requireAuth,
  standardLimiter,
  proxyTo(process.env.OPPORTUNITY_SERVICE_URL)
);

module.exports = router;
