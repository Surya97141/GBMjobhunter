// Tests for the hosted-demo launcher (scripts/demo-start.js).
// Uses node:test only. Run: node --test scripts/__tests__/demo-start.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');

const {
  INTERNAL_PORTS, parseConfig, nodeOptionsWithHeap, buildServices, childEnv,
  createSupervisor, waitForHttp,
} = require('../demo-start');

const ROOT = path.join(__dirname, '..', '..');
const BASE_ENV = Object.freeze({
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL:    'redis://localhost:6379',
  JWT_SECRET:   'secret',
});

const byName = (services) => Object.fromEntries(services.map((s) => [s.name, s]));

// ── parseConfig ──────────────────────────────────────────────────────────────

test('parseConfig: requires DATABASE_URL, REDIS_URL and JWT_SECRET', () => {
  assert.throws(() => parseConfig({}), /DATABASE_URL, REDIS_URL, JWT_SECRET env vars are required/);
  assert.throws(() => parseConfig({ ...BASE_ENV, JWT_SECRET: '' }), /JWT_SECRET env var is required/);
});

test('parseConfig: GROQ_API_KEY is optional and the agent still runs without it', () => {
  const config = parseConfig({ ...BASE_ENV });
  assert.equal(config.runAgent, true);
  assert.ok(byName(buildServices(config)).agent);
});

test('parseConfig: defaults', () => {
  const config = parseConfig({ ...BASE_ENV });
  assert.deepEqual(config, {
    publicPort: '10000',
    heapMb:     96,
    runAgent:   true,
    runWorker:  true,
    trustProxy: '1',
    agentUrl:   'http://localhost:3005',
  });
});

test('parseConfig: rejects a malformed or tiny DEMO_HEAP_MB', () => {
  for (const bad of ['abc', '96MB', '-1', '0', '8', '']) {
    assert.throws(() => parseConfig({ ...BASE_ENV, DEMO_HEAP_MB: bad }), /DEMO_HEAP_MB/, `value ${JSON.stringify(bad)}`);
  }
  assert.equal(parseConfig({ ...BASE_ENV, DEMO_HEAP_MB: '128' }).heapMb, 128);
});

test('parseConfig: DEMO_RUN_AGENT=false and DEMO_RUN_WORKER=false switch those processes off', () => {
  const config = parseConfig({ ...BASE_ENV, DEMO_RUN_AGENT: 'false', DEMO_RUN_WORKER: 'false' });
  const names = buildServices(config).map((s) => s.name);
  assert.deepEqual(names, ['user', 'jobs', 'opportunity', 'gateway']);
});

// ── buildServices ────────────────────────────────────────────────────────────

test('buildServices: agent listens on 3005 and the gateway points at it', () => {
  const services = byName(buildServices(parseConfig({ ...BASE_ENV, PORT: '10000' })));
  assert.equal(services.agent.dir, 'services/agent');
  assert.equal(services.agent.env.PORT, '3005');
  assert.equal(INTERNAL_PORTS.agent, '3005');
  assert.equal(services.gateway.env.AGENT_SERVICE_URL, 'http://localhost:3005');
  assert.equal(services.gateway.env.PORT, '10000');
});

test('buildServices: every HTTP service gets its own port and none takes the public one', () => {
  const services = buildServices(parseConfig({ ...BASE_ENV, PORT: '10000' }));
  const ports = services.filter((s) => s.env.PORT).map((s) => s.env.PORT);
  assert.equal(new Set(ports).size, ports.length);
  assert.deepEqual(services.filter((s) => s.env.PORT === '10000').map((s) => s.name), ['gateway']);
  assert.equal(services.at(-1).name, 'gateway');
});

test('buildServices: AGENT_SERVICE_URL override reaches the gateway only', () => {
  const services = byName(buildServices(parseConfig({ ...BASE_ENV, AGENT_SERVICE_URL: 'http://ai.internal:9000' })));
  assert.equal(services.gateway.env.AGENT_SERVICE_URL, 'http://ai.internal:9000');
  assert.equal(services.agent.env.PORT, '3005');
});

// ── child environment ────────────────────────────────────────────────────────

test('nodeOptionsWithHeap: keeps other flags and replaces any existing heap cap', () => {
  assert.equal(nodeOptionsWithHeap(undefined, 96), '--max-old-space-size=96');
  assert.equal(
    nodeOptionsWithHeap('--enable-source-maps  --max-old-space-size=2048', 96),
    '--enable-source-maps --max-old-space-size=96',
  );
});

test('childEnv: agent inherits secrets, overrides the host PORT and gets the heap cap', () => {
  const parent = { ...BASE_ENV, PORT: '10000', GROQ_API_KEY: 'gsk_test' };
  const env = childEnv(parent, 96, { PORT: '3005' });
  assert.equal(env.PORT, '3005');
  assert.equal(env.GROQ_API_KEY, 'gsk_test');
  assert.equal(env.REDIS_URL, BASE_ENV.REDIS_URL);
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=96');
  assert.equal(parent.PORT, '10000', 'parent env is not mutated');
});

// ── supervisor ───────────────────────────────────────────────────────────────

function fakeHarness(extra = {}) {
  const spawned = [];
  const exits = [];
  const out = new PassThrough();
  const err = new PassThrough();
  let outText = '';
  let errText = '';
  out.on('data', (c) => { outText += c; });
  err.on('data', (c) => { errText += c; });

  const spawnFn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killedWith = null;
    child.kill = (sig) => { child.killedWith = sig; };
    spawned.push({ cmd, args, opts, child });
    return child;
  };

  const supervisor = createSupervisor({
    spawnFn, exit: (code) => exits.push(code), stdout: out, stderr: err,
    root: '/app', graceMs: 5, parentEnv: { ...BASE_ENV, PORT: '10000' }, heapMb: 96, ...extra,
  });
  return { supervisor, spawned, exits, text: () => ({ out: outText, err: errText }) };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('supervisor: spawns services/agent with PORT 3005 and the heap cap', () => {
  const { supervisor, spawned } = fakeHarness();
  buildServices(parseConfig({ ...BASE_ENV })).forEach(supervisor.start);

  const agent = spawned.find((s) => s.opts.cwd === path.join('/app', 'services/agent'));
  assert.ok(agent, 'agent was spawned');
  assert.equal(agent.cmd, process.execPath);
  assert.deepEqual(agent.args, ['index.js']);
  assert.equal(agent.opts.env.PORT, '3005');
  assert.equal(agent.opts.env.NODE_OPTIONS, '--max-old-space-size=96');
  assert.deepEqual(agent.opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(spawned.length, 6);
});

test('supervisor: prefixes child output with the service name', async () => {
  const { supervisor, spawned, text } = fakeHarness();
  supervisor.start({ name: 'agent', dir: 'services/agent', env: { PORT: '3005' } });
  spawned[0].child.stdout.write('Agent Service running on port 3005\npartial');
  spawned[0].child.stderr.write('oops\n');
  await tick();
  assert.equal(text().out, '[agent] Agent Service running on port 3005\n');
  assert.equal(text().err, '[agent] oops\n');
});

test('supervisor: an agent crash stops every child and exits 1 once', async () => {
  const { supervisor, spawned, exits, text } = fakeHarness();
  buildServices(parseConfig({ ...BASE_ENV })).forEach(supervisor.start);
  const agent = spawned.find((s) => s.opts.cwd.endsWith('services/agent')).child;

  agent.emit('exit', 1, null);
  // Children exiting because we killed them must not trigger a second shutdown.
  spawned.forEach((s) => s.child.emit('exit', null, 'SIGTERM'));
  await tick();

  assert.ok(spawned.every((s) => s.child.killedWith === 'SIGTERM'));
  assert.deepEqual(exits, [1]);
  assert.match(text().err, /\[demo\] agent exited \(code=1, signal=null\); stopping all/);
});

test('supervisor: a spawn error is handled like a crash instead of throwing', async () => {
  const { supervisor, spawned, exits, text } = fakeHarness();
  supervisor.start({ name: 'agent', dir: 'services/agent', env: {} });
  supervisor.start({ name: 'gateway', dir: 'gateway', env: {} });
  spawned[0].child.emit('error', new Error('spawn ENOENT'));
  await tick();
  assert.deepEqual(exits, [1]);
  assert.equal(spawned[1].child.killedWith, 'SIGTERM');
  assert.match(text().err, /agent failed to start \(spawn ENOENT\)/);
});

test('supervisor: a requested shutdown exits 0', async () => {
  const { supervisor, spawned, exits } = fakeHarness();
  supervisor.start({ name: 'agent', dir: 'services/agent', env: {} });
  supervisor.shutdown(0);
  supervisor.shutdown(1); // ignored
  spawned[0].child.emit('exit', null, 'SIGTERM');
  await tick();
  assert.deepEqual(exits, [0]);
  assert.equal(supervisor.isShuttingDown(), true);
});

// ── waitForHttp ──────────────────────────────────────────────────────────────

test('waitForHttp: true once the URL answers 2xx, false on timeout', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal(await waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 }), true);
  } finally {
    server.close();
  }
  assert.equal(await waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 300, intervalMs: 50 }), false);
});

// ── real agent process ───────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(String(port)));
    });
  });
}

test('the real agent service starts under the launcher, without GROQ_API_KEY, and serves /agent/health', async (t) => {
  const port = await freePort();
  const deadPort = await freePort(); // nothing listens here: Redis/Postgres are down
  const parentEnv = {
    PATH: process.env.PATH,
    ...BASE_ENV,
    DATABASE_URL: `postgres://u:p@127.0.0.1:${deadPort}/db`,
    REDIS_URL:    `redis://127.0.0.1:${deadPort}`,
    PORT:         '10000',
    NODE_ENV:     'test',
  };
  const exits = [];
  const sink = new PassThrough();
  let output = '';
  sink.on('data', (c) => { output += c; });

  const supervisor = createSupervisor({
    root: ROOT, parentEnv, heapMb: 96, graceMs: 10, exit: (code) => exits.push(code), stdout: sink, stderr: sink,
  });
  const [agentSpec] = buildServices(parseConfig(parentEnv), { ...INTERNAL_PORTS, agent: port })
    .filter((s) => s.name === 'agent');
  supervisor.start(agentSpec);
  t.after(() => supervisor.shutdown(0));

  const up = await waitForHttp(`http://127.0.0.1:${port}/agent/health`, { timeoutMs: 15_000, intervalMs: 200 });
  assert.equal(up, true, `agent did not come up on ${port}. Output:\n${output}`);
  assert.match(output, new RegExp(`\\[agent\\] Agent Service running on port ${port}`));
  assert.deepEqual(exits, [], 'agent must not crash when Redis is unreachable at boot');
});
