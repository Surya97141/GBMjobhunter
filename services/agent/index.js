require('dotenv').config();

if (!process.env.REDIS_URL) throw new Error('REDIS_URL env var is required');

const express = require('express');

const app    = express();
const router = express.Router();

app.use(express.json());

// ── Health — tier configuration check ────────────────────────────────────────
router.get('/health', (_req, res) => {
  const TIER2_REQUIRED = ['TIER2_API_BASE', 'TIER2_API_KEY', 'TIER2_MODEL_NAME'];
  const tier2Missing   = TIER2_REQUIRED.filter(v => !process.env[v]);
  const tier2Ok        = tier2Missing.length === 0;
  const tier3Ok        = !!process.env.TIER3_API_KEY;

  res.json({
    status: 'ok',
    tiers: {
      tier1: {
        status: 'always_available',
        note:   'runs client-side or via direct DB query — not routed through this service',
      },
      tier2: {
        status:  tier2Ok ? 'configured' : 'not_configured',
        model:   process.env.TIER2_MODEL_NAME || null,
        ...(tier2Missing.length && { missing: tier2Missing }),
      },
      tier3: {
        status:  tier3Ok ? 'configured' : 'not_configured',
        model:   process.env.TIER3_MODEL || 'claude-sonnet-4-6',
        ...(!tier3Ok && { missing: ['TIER3_API_KEY'] }),
      },
    },
    quota: {
      tier3_per_day: Number(process.env.TIER3_QUOTA_PER_DAY) || 5,
    },
  });
});

// All routes are mounted under /agent — matching how the gateway proxies them.
// gateway: router.use('/agent', ...) → forwards /agent/* unchanged.
app.use('/agent', router);

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Agent Service running on port ${PORT}`));
