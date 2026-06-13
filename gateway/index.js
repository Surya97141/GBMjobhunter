require('dotenv').config();

if (!process.env.JWT_SECRET)              throw new Error('JWT_SECRET env var is required');
if (!process.env.USER_SERVICE_URL)        throw new Error('USER_SERVICE_URL env var is required');
if (!process.env.JOBS_SERVICE_URL)        throw new Error('JOBS_SERVICE_URL env var is required');
if (!process.env.OPPORTUNITY_SERVICE_URL) throw new Error('OPPORTUNITY_SERVICE_URL env var is required');
if (!process.env.REDIS_URL)              throw new Error('REDIS_URL env var is required');

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const proxyRoutes = require('./src/routes/proxy.routes');

const app = express();

// ── Security headers ────────────────────────────────────────────────────────
// helmet sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.
// CSP is disabled because this is a JSON API server — no HTML is served.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ────────────────────────────────────────────────────────────────────
// Allowed origins: web app dev server, any Chrome extension, and any origin
// listed in ALLOWED_ORIGINS (comma-separated; set in production env).
// Requests with no Origin header (curl, Postman, mobile) are always allowed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',');

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                              // no-origin: allowed
    if (origin.startsWith('chrome-extension://')) return cb(null, true); // extension: allowed
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);    // listed: allowed
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// ── Body parsing ────────────────────────────────────────────────────────────
// Explicit 100 kb limit prevents request-body DoS; default is also 100 kb but
// being explicit makes the limit visible and reviewable.
app.use(express.json({ limit: '100kb' }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/', proxyRoutes);

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway running on port ${PORT}`);
});
