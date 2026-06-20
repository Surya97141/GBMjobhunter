// Phase G — Outreach Agent verification (4 checks)
// node scripts/dev-verification/verify-phase-g.js
const { chromium } = require('playwright');

const GATEWAY       = 'http://localhost:3000';
const AGENT_DIRECT  = 'http://localhost:3005';
const EXTENSION_SRC = 'd:\\GBMjobhunter\\extension';

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg)       { console.log(`     ${msg}`); }
function sep(title)      { console.log(`\n── ${title} ${'─'.repeat(Math.max(0,50-title.length))}`); }

async function login() {
  const r = await fetch(`${GATEWAY}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
  });
  return (await r.json()).data?.token;
}

async function postOutreach(token, body) {
  const r = await fetch(`${GATEWAY}/agent/generate-outreach`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  console.log('\n═══ Phase G — Outreach Agent Verification ═══\n');

  // ── Pre-flight: health ────────────────────────────────────────────────────
  sep('Pre-flight: health');
  const healthRes  = await fetch(`${AGENT_DIRECT}/agent/health`);
  const health     = await healthRes.json();
  const tier3State = health.tiers?.tier3?.status;
  const tier2State = health.tiers?.tier2?.status;
  note(`tier2=${tier2State}  tier3=${tier3State}  quota_per_day=${health.quota?.tier3_per_day}`);
  p(tier3State === 'not_configured', `Tier 3 is not_configured (phase F wipe carried over)`);
  p(tier2State === 'not_configured', `Tier 2 is not_configured (phase F wipe carried over)`);

  // ── Login ─────────────────────────────────────────────────────────────────
  const token = await login();
  if (!token) { console.log('\nBLOCKED: login failed'); return; }
  note(`JWT obtained for test@example.com`);

  // ── CHECK 1 — Single call confirms not_configured ─────────────────────────
  sep('CHECK 1 — Single POST → not_configured shape');
  const r1 = await postOutreach(token, {
    companyName: 'Acme Corp',
    roleTitle:   'Senior Software Engineer',
    jdText:      'Build distributed backend systems at scale.',
  });
  note(`Response: ${JSON.stringify(r1)}`);
  const isNotConfigured = r1.success === false && r1.error === 'not_configured';
  p(isNotConfigured, `Returns success=false, error='not_configured'`);
  p(typeof r1.message === 'string', `Message field present: "${r1.message}"`);

  // ── CHECK 2 — 6 consecutive calls: quota consumed before key check? ───────
  sep('CHECK 2 — 6 consecutive calls, quota order test');
  note('callTier3 checks quota BEFORE checking TIER3_API_KEY (lines 125→139 in modelRouter).');
  note('With QUOTA_PER_DAY=5, calls 1-5 → not_configured (quota consumed but allowed=true).');
  note('Call 6 → quota_exceeded (counter=6 > 5, quota check fires before key check).');
  console.log('');

  // Note: call 1 was already made in CHECK 1, so Redis counter is now 1.
  // Calls 2-5 should return not_configured; call 6 returns quota_exceeded.
  const results = [r1]; // include CHECK 1 call as call #1
  for (let i = 2; i <= 6; i++) {
    const r = await postOutreach(token, {
      companyName: 'Acme Corp',
      roleTitle:   'Senior Software Engineer',
    });
    results.push(r);
  }

  results.forEach((r, i) => {
    const label = r.error === 'not_configured' ? 'not_configured' :
                  r.error === 'quota_exceeded'  ? 'QUOTA_EXCEEDED' :
                  r.success === true            ? 'SUCCESS'         : `other(${r.error})`;
    note(`Call ${i + 1}: ${label}  — ${r.message?.slice(0, 70) ?? ''}`);
  });

  const first5AllNotConfigured = results.slice(0, 5).every(r => r.error === 'not_configured');
  const call6QuotaExceeded     = results[5]?.error === 'quota_exceeded';
  p(first5AllNotConfigured, `Calls 1-5: all not_configured (quota consumed but key check blocked call)`);
  p(call6QuotaExceeded,     `Call 6: quota_exceeded (counter exceeded before key check on call 6)`);

  if (call6QuotaExceeded) {
    note(`Call 6 message: "${results[5].message}"`);
    p(results[5].message?.includes('midnight UTC'), `quota_exceeded message mentions midnight UTC reset`);
  }

  // ── Reset quota before popup checks (so popup shows not_configured, not quota_exceeded) ──
  sep('Resetting quota for popup checks');
  const today  = new Date().toISOString().split('T')[0];
  const userId = 'a6cd83e4-b0ab-4883-81b5-d5b07f3ba1d4';
  const key    = `tier3_quota:${userId}:${today}`;
  // Direct Redis via node — use the service's own redis client pattern
  const { createClient } = require('redis');
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6380' });
  await redis.connect();
  await redis.del(key);
  await redis.disconnect();
  note(`Redis key "${key}" deleted — quota reset to 0`);

  // ── CHECKs 3 & 4 — Extension popup via Playwright ────────────────────────
  sep('CHECK 3 & 4 — Extension popup (Playwright)');
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_SRC}`,
      `--load-extension=${EXTENSION_SRC}`,
    ],
  });

  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    note(`Extension loaded — service worker: ${sw.url().split('/')[2]}`);

    // Seed auth token
    await sw.evaluate(t => chrome.storage.local.set({ auth_token: t }), token);

    const extensionId = sw.url().split('/')[2];
    const popup       = await ctx.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popup.waitForTimeout(1500);

    // Force job state with realistic currentJob
    await popup.evaluate(() => {
      populateJob({
        company:    'Acme Corp',
        role:       'Senior Software Engineer',
        jdText:     'Build distributed backend systems at scale.',
        ats:        null,
        ghostScore: null,
        fields:     [],
      });
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      document.getElementById('state-job').classList.add('active');
    });
    await popup.waitForTimeout(300);

    // ── CHECK 3 — Click "Draft outreach message" → calm not_configured message ──
    sep('CHECK 3 — Calm not_configured message');
    await popup.click('#btn-generate-outreach');
    await popup.waitForFunction(
      () => !document.getElementById('outreach-msg').hidden,
      { timeout: 12000 }
    );

    const outreachMsgText  = await popup.locator('#outreach-msg').innerText();
    const outreachMsgColor = await popup.evaluate(() =>
      window.getComputedStyle(document.getElementById('outreach-msg')).color
    );
    // --danger (#ef4444) → rgb(239, 68, 68) — check "239" absent = not red
    const isCalm     = outreachMsgText.length > 0 && !outreachMsgColor.includes('239');
    const isExpected = outreachMsgText.includes("AI outreach drafting isn't set up yet");
    const blockStillHidden = await popup.locator('#outreach-block').isHidden();

    note(`Message text:  "${outreachMsgText}"`);
    note(`Message color: ${outreachMsgColor}`);
    note(`Outreach block hidden: ${blockStillHidden}`);

    await popup.screenshot({ path: 'd:/GBMjobhunter/verify-g-check3.png' });

    p(isExpected,      `CHECK 3a: Exact calm text — "AI outreach drafting isn't set up yet"`);
    p(isCalm,          `CHECK 3b: Color is not --danger (no red styling)`);
    p(blockStillHidden,`CHECK 3c: Outreach text block stays hidden (no partial success render)`);

    // ── CHECK 4a — Contact toggle + contact name present, role absent from body ──
    sep('CHECK 4 — Contact field spread in request body');

    // Reset popup state for clean 2nd click
    await popup.evaluate(() => {
      document.getElementById('outreach-msg').hidden = true;
    });

    // Expand contact fields
    await popup.click('#btn-contact-toggle');
    await popup.waitForFunction(
      () => !document.getElementById('contact-fields').hidden,
      { timeout: 3000 }
    );
    note(`Contact fields expanded`);

    // Fill name only, leave role empty
    await popup.fill('#contact-name', 'Jane Smith');
    // contact-role left blank

    // Intercept the outreach request to inspect the body
    let capturedBody4a = null;
    popup.once('request', req => {
      if (req.url().includes('generate-outreach')) {
        capturedBody4a = JSON.parse(req.postData() || '{}');
      }
    });

    await popup.click('#btn-generate-outreach');
    await popup.waitForTimeout(5000); // wait for round-trip

    note(`CHECK 4a request body: ${JSON.stringify(capturedBody4a)}`);
    const has4aContactName = capturedBody4a?.contactName === 'Jane Smith';
    const has4aNoRole      = !('contactRole' in (capturedBody4a ?? {}));
    p(has4aContactName, `CHECK 4a: contactName='Jane Smith' present in body`);
    p(has4aNoRole,      `CHECK 4a: contactRole key ABSENT from body (not empty string, truly absent)`);

    // ── CHECK 4b — Both empty → neither key present in body ──────────────────
    await popup.evaluate(() => {
      document.getElementById('outreach-msg').hidden = true;
      document.getElementById('contact-name').value  = '';
      document.getElementById('contact-role').value  = '';
    });

    let capturedBody4b = null;
    popup.once('request', req => {
      if (req.url().includes('generate-outreach')) {
        capturedBody4b = JSON.parse(req.postData() || '{}');
      }
    });

    await popup.click('#btn-generate-outreach');
    await popup.waitForTimeout(5000);

    note(`CHECK 4b request body: ${JSON.stringify(capturedBody4b)}`);
    const has4bNoName = !('contactName' in (capturedBody4b ?? {}));
    const has4bNoRole = !('contactRole' in (capturedBody4b ?? {}));
    p(has4bNoName, `CHECK 4b: contactName key ABSENT when input is empty`);
    p(has4bNoRole, `CHECK 4b: contactRole key ABSENT when input is empty`);

  } finally {
    await ctx.close();
  }

  console.log('\n═══ Done ═══\n');
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
