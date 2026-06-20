// Phase E Half 2 — Step 7 verification (3 checks)
// node verify-phase-e-half2.js (from project root)
const { chromium } = require('playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const GATEWAY       = 'http://localhost:3000';
const EXTENSION_SRC = 'd:\\GBMjobhunter\\extension';
const EXPECTED_FILL = 'Excited to apply for Senior Software Engineer at Acme Corp.';
const TEST_PORT     = 8765;

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg) { console.log(`     ${msg}`); }

async function login(email, pw) {
  const r = await fetch(GATEWAY + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  return (await r.json()).data?.token;
}

function startTestServer() {
  const html = fs.readFileSync(path.join(__dirname, 'test-job-page.html'), 'utf8');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise(resolve => server.listen(TEST_PORT, () => resolve(server)));
}

async function main() {
  console.log('\n─── Phase E Step 7: Half 2 verification ──────────────\n');

  const token = await login('test@example.com', 'password123');
  if (!token) { console.log('BLOCKED: no token'); return; }

  // ── CHECK 1 — Direct POST confirms not_configured shape ──────────────────
  const genRes = await fetch(GATEWAY + '/agent/generate-cover-letter', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      role:           'Senior Software Engineer',
      company:        'Acme Corp',
      jobDescription: 'Distributed systems role.',
    }),
  });
  const genBody = await genRes.json();

  const isNotConfigured = genBody.success === false && genBody.error === 'not_configured';
  p(isNotConfigured, `CHECK 1: POST /agent/generate-cover-letter → ${JSON.stringify(genBody)}`);

  // ── CHECKS 2 & 3 — Extension popup calm message + cover letter preserved ──
  const server   = await startTestServer();
  const JOB_PAGE = `http://localhost:${TEST_PORT}/test-job-page.html`;

  try {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_SRC}`,
        `--load-extension=${EXTENSION_SRC}`,
      ],
    });

    const jobPage = await ctx.newPage();
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

    // Seed auth token into extension storage
    await sw.evaluate(t => chrome.storage.local.set({
      auth_token: t, user_profile: null, user_profile_ts: 0,
    }), token);

    // ── Set up job page with Half 1 cover letter already filled ────────────
    await jobPage.goto(JOB_PAGE);
    await jobPage.waitForTimeout(1000);

    await sw.evaluate(async ({ tok, apiBase }) => {
      const res  = await fetch(`${apiBase}/users/me`, { headers: { Authorization: `Bearer ${tok}` } });
      const user = (await res.json()).data?.user;
      const nameParts = (user.name || '').trim().split(/\s+/);
      const profile = {
        firstName:           nameParts[0]                || '',
        lastName:            nameParts.slice(1).join(' ') || '',
        email:               user.email                  || '',
        phone:               '',
        linkedin:            '',
        website:             '',
        location:            user.target_location        || '',
        coverLetterTemplate: user.cover_letter_template  || '',
      };
      const tabs   = await chrome.tabs.query({});
      const jobTab = tabs.find(t => t.url && t.url.includes('test-job-page'));
      if (!jobTab) return;
      await chrome.scripting.executeScript({ target: { tabId: jobTab.id }, files: ['src/content/index.js'] });
      await new Promise(r => setTimeout(r, 800));
      await chrome.tabs.sendMessage(jobTab.id, { type: 'START_AUTOFILL', profile }).catch(() => {});
    }, { tok: token, apiBase: GATEWAY });

    await jobPage.waitForTimeout(2000);
    const clBefore = await jobPage.locator('textarea[name="cover_letter"]').inputValue();
    note(`Cover letter before generate: "${clBefore}"`);

    // ── Open popup, manually switch to job state, click generate ─────────────
    // The popup tab becomes the active tab so GET_PAGE_STATE returns idle.
    // We call populateJob() — a top-level function in popup.js's global scope —
    // to set currentJob and render the job state, same pattern used in Phase C.
    const extensionId = sw.url().split('/')[2];
    const popupPage   = await ctx.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.waitForTimeout(1500); // let init() run to completion

    await popupPage.evaluate(() => {
      populateJob({
        company:    'Acme Corp',
        role:       'Senior Software Engineer',
        jdText:     'We are looking for a Senior Software Engineer to join our team.',
        ats:        null,
        ghostScore: null,
        fields:     [{ type: 'COVER_LETTER', label: 'Cover letter' }],
      });
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      document.getElementById('state-job').classList.add('active');
    });
    await popupPage.waitForTimeout(300);

    // Click the generate button — makes a real POST to the gateway
    await popupPage.click('#btn-generate-cl');

    // Wait for the calm message to appear (real network round-trip)
    await popupPage.waitForFunction(
      () => !document.getElementById('cl-generate-msg').hidden,
      { timeout: 10000 }
    );

    const msgText  = await popupPage.locator('#cl-generate-msg').innerText();
    const msgColor = await popupPage.evaluate(() =>
      window.getComputedStyle(document.getElementById('cl-generate-msg')).color
    );
    // var(--danger) resolves to #ef4444 → rgb(239, 68, 68). The calm .cl-msg uses
    // var(--text-secondary) = #6b7280 → rgb(107, 114, 128). Check: no "239" = not red.
    const isCalm = msgText.length > 0 && !msgColor.includes('239');

    await popupPage.screenshot({ path: 'd:/GBMjobhunter/verify-e-half2-popup.png', fullPage: false });

    p(isCalm, `CHECK 2: Calm message — "${msgText}" color=${msgColor}`);

    // ── CHECK 3 — Cover letter field unchanged after failed generate ──────────
    const clAfter = await jobPage.locator('textarea[name="cover_letter"]').inputValue();
    p(
      clAfter === EXPECTED_FILL,
      `CHECK 3: Cover letter preserved — "${clAfter}"`
    );
    if (clAfter !== EXPECTED_FILL) note(`Expected: "${EXPECTED_FILL}"`);

    await ctx.close();

  } finally {
    server.close();
  }

  console.log('\n─── Done ──────────────────────────────────────────────\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
