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
 *               DEMO_RUN_AGENT, DEMO_RUN_WORKER, DEMO_HEAP_MB, TRUST_PROXY,
 *               AGENT_SERVICE_URL: see parseConfig below and .env.demo.example.
 *
 * The pieces are exported so scripts/__tests__/demo-start.test.js can check
 * them without a database; the launcher only runs when executed directly.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const REQUIRED_ENV = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];

// Internal ports: only reachable inside the container. The gateway's
// AGENT_SERVICE_URL and the agent's PORT must agree, so both come from here.
const INTERNAL_PORTS = Object.freeze({ user: '3001', jobs: '3002', opportunity: '3003', agent: '3005' });

const DEFAULT_HEAP_MB = 96;

/**
 * Reads the launcher settings from `env`. Throws with a readable message when
 * something is missing or malformed, before any child process is started.
 */
function parseConfig(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`${missing.join(', ')} env var${missing.length > 1 ? 's are' : ' is'} required`);
  }

  // Cap each process's heap so the Node processes fit a 512 MB free instance.
  // A bad value here would make Node reject NODE_OPTIONS and every child would
  // die at startup, so reject it up front instead.
  const heapRaw = env.DEMO_HEAP_MB ?? String(DEFAULT_HEAP_MB);
  if (!/^\d+$/.test(heapRaw) || Number(heapRaw) < 16) {
    throw new Error(`DEMO_HEAP_MB must be a whole number of megabytes >= 16 (got "${heapRaw}")`);
  }

  return {
    publicPort: env.PORT || '10000',
    heapMb:     Number(heapRaw),
    // Run the agent (AI) service too (default on). Set DEMO_RUN_AGENT=false to
    // skip it on a very small instance; /agent/* then returns 502 and the UI
    // says AI is unavailable. GROQ_API_KEY is NOT required for the agent.
    runAgent:   env.DEMO_RUN_AGENT !== 'false',
    // Run the intelligence worker too (default on). Without a consumer, BullMQ
    // events from the jobs service would pile up in the small free Redis instance.
    runWorker:  env.DEMO_RUN_WORKER !== 'false',
    trustProxy: env.TRUST_PROXY || '1',
    agentUrl:   env.AGENT_SERVICE_URL || `http://localhost:${INTERNAL_PORTS.agent}`,
  };
}

/**
 * NODE_OPTIONS for a child: keeps any flags the host already set and replaces
 * only the heap limit, so the cap cannot be silently overridden or doubled.
 */
function nodeOptionsWithHeap(existing, heapMb) {
  const kept = (existing || '')
    .split(/\s+/)
    .filter((flag) => flag && !flag.startsWith('--max-old-space-size'));
  return [...kept, `--max-old-space-size=${heapMb}`].join(' ');
}

/**
 * The processes to start, in order, as { name, dir, env } where `env` holds
 * only the per-service overrides (merged over the parent env at spawn time).
 */
function buildServices(config, ports = INTERNAL_PORTS) {
  const services = [
    { name: 'user',        dir: 'services/user',        env: { PORT: ports.user, DEMO_MODE_ENABLED: 'true' } },
    { name: 'jobs',        dir: 'services/jobs',        env: { PORT: ports.jobs } },
    { name: 'opportunity', dir: 'services/opportunity', env: { PORT: ports.opportunity } },
  ];
  if (config.runAgent) {
    services.push({ name: 'agent', dir: 'services/agent', env: { PORT: ports.agent } });
  }
  if (config.runWorker) {
    // A queue worker with no HTTP server, so it needs no port.
    services.push({ name: 'intelligence', dir: 'services/intelligence', env: {} });
  }
  // Services listen within a second or two; the gateway only contacts them
  // when a request arrives, so there is no ordering problem.
  services.push({
    name: 'gateway',
    dir:  'gateway',
    env: {
      PORT:                    config.publicPort,
      USER_SERVICE_URL:        `http://localhost:${ports.user}`,
      JOBS_SERVICE_URL:        `http://localhost:${ports.jobs}`,
      OPPORTUNITY_SERVICE_URL: `http://localhost:${ports.opportunity}`,
      AGENT_SERVICE_URL:       config.agentUrl,
      TRUST_PROXY:             config.trustProxy,
    },
  });
  return services;
}

/** The full environment for one child process. */
function childEnv(parentEnv, heapMb, overrides) {
  const env = { ...parentEnv, NODE_OPTIONS: nodeOptionsWithHeap(parentEnv.NODE_OPTIONS, heapMb) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * Starts and watches child processes. Any unexpected child exit stops all the
 * others and exits with code 1; a SIGTERM/SIGINT stops them and exits with 0.
 * Dependencies are injectable for tests.
 */
function createSupervisor({
  spawnFn   = spawn,
  exit      = (code) => process.exit(code),
  stdout    = process.stdout,
  stderr    = process.stderr,
  root      = ROOT,
  graceMs   = 3000,
  parentEnv = process.env,
  heapMb    = DEFAULT_HEAP_MB,
} = {}) {
  const children = [];
  let shuttingDown = false;

  function prefix(stream, sink, name) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => sink.write(`[${name}] ${line}\n`));
    });
  }

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    children.forEach((c) => c.kill('SIGTERM'));
    setTimeout(() => exit(code), graceMs).unref();
  }

  function start({ name, dir, env }) {
    const child = spawnFn(process.execPath, ['index.js'], {
      cwd:   path.join(root, dir),
      env:   childEnv(parentEnv, heapMb, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    prefix(child.stdout, stdout, name);
    prefix(child.stderr, stderr, name);

    // 'error' fires if the process could not be spawned at all; without a
    // listener it would crash the launcher instead of shutting down cleanly.
    child.on('error', (err) => {
      if (shuttingDown) return;
      stderr.write(`[demo] ${name} failed to start (${err.message}); stopping all\n`);
      shutdown(1);
    });
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      stderr.write(`[demo] ${name} exited (code=${code}, signal=${signal}); stopping all\n`);
      shutdown(1);
    });

    children.push(child);
    return child;
  }

  return { start, shutdown, children, isShuttingDown: () => shuttingDown };
}

/**
 * Polls `url` until it answers 2xx or `timeoutMs` passes. Resolves true/false;
 * never throws. Used only to log whether the agent came up: a slow agent does
 * not stop the rest of the backend.
 */
async function waitForHttp(url, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function runOnce(label, script) {
  console.log(`[demo] ${label}`);
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    stdio: 'inherit',
    env:   process.env,
  });
  if (result.status !== 0) {
    console.error(`[demo] ${label} failed (exit ${result.status})`);
    process.exit(1);
  }
}

function main() {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    console.error(`[demo] ${err.message}`);
    process.exit(1);
  }

  // ── 1. Database setup ──────────────────────────────────────────────────────
  runOnce('applying migrations', 'scripts/migrate.js');
  runOnce('seeding skill demand', 'scripts/seed-skill-demand.js');

  // ── 2 + 3. Services, then the public gateway ───────────────────────────────
  const supervisor = createSupervisor({ heapMb: config.heapMb });
  process.on('SIGTERM', () => supervisor.shutdown(0));
  process.on('SIGINT',  () => supervisor.shutdown(0));

  const services = buildServices(config);
  services.forEach(supervisor.start);
  console.log(
    `[demo] backend starting (${services.map((s) => s.name).join(', ')}; ` +
    `heap cap ${config.heapMb} MB each); gateway on port ${config.publicPort}`,
  );

  if (config.runAgent) {
    const healthUrl = `http://localhost:${INTERNAL_PORTS.agent}/agent/health`;
    waitForHttp(healthUrl).then((up) => {
      if (supervisor.isShuttingDown()) return;
      if (up) {
        console.log(`[demo] agent ready on port ${INTERNAL_PORTS.agent}` +
          (process.env.GROQ_API_KEY ? '' : ' (GROQ_API_KEY unset: demo AI off, bring-your-own-key AI on)'));
      } else {
        console.error(`[demo] agent did not answer ${healthUrl} within 30s; /agent/* requests will fail until it does`);
      }
    });
  }
}

module.exports = {
  INTERNAL_PORTS,
  DEFAULT_HEAP_MB,
  parseConfig,
  nodeOptionsWithHeap,
  buildServices,
  childEnv,
  createSupervisor,
  waitForHttp,
};

if (require.main === module) main();
