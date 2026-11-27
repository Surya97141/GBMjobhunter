/**
 * Single-container launcher for the hosted demo.
 *
 * Render's free tier gives one web service, and free services sleep when idle.
 * Running every backend as its own free service would chain cold starts
 * (gateway wakes, then each upstream wakes) and blow the shared free-hours
 * budget. Instead, this script runs the whole backend inside ONE service:
 *
 *   1. apply migrations and seed skill demand (both idempotent)
 *   2. start user, jobs, opportunity, agent (AI) and the intelligence worker on localhost
 *   3. start the gateway on the public $PORT
 *
 * If any child dies, this process exits so the platform restarts everything
 * together rather than leaving a half-working backend.
 *
 * Run: node scripts/demo-start.js
 * Required env: DATABASE_URL, REDIS_URL, JWT_SECRET, PORT (set by the host)
 * Optional env: GROQ_API_KEY enables the shared "demo" AI mode. Without it the
 *               agent still runs: bring-your-own-key AI works, demo AI reports
 *               itself unavailable, and the rest of the app is unaffected.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

for (const name of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET']) {
  if (!process.env[name]) {
    console.error(`[demo] ${name} env var is required`);
    process.exit(1);
  }
}

const PUBLIC_PORT = process.env.PORT || '10000';

// Internal ports: only reachable inside the container.
const INTERNAL = { user: '3001', jobs: '3002', opportunity: '3003', agent: '3005' };

// Run the intelligence worker too (default on). Without a consumer, BullMQ
// events from the jobs service would pile up in the small free Redis instance.
const RUN_WORKER = process.env.DEMO_RUN_WORKER !== 'false';

// Run the agent (AI) service too (default on). Set DEMO_RUN_AGENT=false to skip
// it on a very small instance; /agent/* then returns 502 and the UI says AI is
// unavailable.
const RUN_AGENT = process.env.DEMO_RUN_AGENT !== 'false';

// Cap each process's heap so the Node processes fit a 512 MB free instance.
const HEAP_MB = process.env.DEMO_HEAP_MB || '96';

// ── 1. Database setup ────────────────────────────────────────────────────────
function runOnce(label, script) {
  console.log(`[demo] ${label}`);
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[demo] ${label} failed (exit ${result.status})`);
    process.exit(1);
  }
}

runOnce('applying migrations', 'scripts/migrate.js');
runOnce('seeding skill demand', 'scripts/seed-skill-demand.js');

// ── 2. Start the services ────────────────────────────────────────────────────
const children = [];
let shuttingDown = false;

function start(name, dir, extraEnv) {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, dir),
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = (stream, sink) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => sink.write(`[${name}] ${line}\n`));
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[demo] ${name} exited (code=${code}, signal=${signal}); stopping all`);
    shutdown(1);
  });

  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

start('user',        'services/user',        { PORT: INTERNAL.user, DEMO_MODE_ENABLED: 'true' });
start('jobs',        'services/jobs',        { PORT: INTERNAL.jobs });
start('opportunity', 'services/opportunity', { PORT: INTERNAL.opportunity });
if (RUN_AGENT)  start('agent',       'services/agent',       { PORT: INTERNAL.agent });
if (RUN_WORKER) start('intelligence', 'services/intelligence', {});

// ── 3. Public gateway ────────────────────────────────────────────────────────
// Services listen within a second or two; the gateway only contacts them when
// a request arrives, so there is no ordering problem.
start('gateway', 'gateway', {
  PORT: PUBLIC_PORT,
  USER_SERVICE_URL:        `http://localhost:${INTERNAL.user}`,
  JOBS_SERVICE_URL:        `http://localhost:${INTERNAL.jobs}`,
  OPPORTUNITY_SERVICE_URL: `http://localhost:${INTERNAL.opportunity}`,
  AGENT_SERVICE_URL:       process.env.AGENT_SERVICE_URL || `http://localhost:${INTERNAL.agent}`,
  TRUST_PROXY:             process.env.TRUST_PROXY || '1',
});

console.log(`[demo] backend starting; gateway on port ${PUBLIC_PORT}`);
