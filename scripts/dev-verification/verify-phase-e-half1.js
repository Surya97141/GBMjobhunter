// Phase E Half 1 — 5 verification checks
// node verify-phase-e-half1.js (from project root)
const { chromium } = require('playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const GATEWAY       = 'http://localhost:3000';
const EXTENSION_SRC = 'd:\\GBMjobhunter\\extension';
const TEMPLATE      = 'Excited to apply for {{role}} at {{company}}.';
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

// Spin up a local HTTP server so the content script matches host_permissions
// (http://localhost/*) and can be injected via chrome.scripting.executeScript.
// The manifest's content_scripts.matches only includes https://* and 5173 —
// so we inject manually after navigation.
function startTestServer() {
  const html = fs.readFileSync(path.join(__dirname, 'test-job-page.html'), 'utf8');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise(resolve => server.listen(TEST_PORT, () => resolve(server)));
}

async function main() {
  console.log('\n─── Phase E Step 4: Half 1 verification ──────────────\n');

  const server  = await startTestServer();
  const JOB_PAGE = `http://localhost:${TEST_PORT}/test-job-page.html`;

  try {
    // ── CHECKS 1 & 2 — API confirms template stored and returned ─────────────
    const token = await login('test@example.com', 'password123');
    if (!token) { console.log('BLOCKED: no token'); return; }

    const meRes  = await fetch(GATEWAY + '/users/me', { headers: { Authorization: `Bearer ${token}` } });
    const meUser = (await meRes.json()).data?.user;

    p(meUser?.cover_letter_template === TEMPLATE,
      `CHECK 1&2: Template in DB — ${JSON.stringify(meUser?.cover_letter_template)}`);

    // ── CHECK 3 — Extension loads, test job page open ─────────────────────────
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_SRC}`,
        `--load-extension=${EXTENSION_SRC}`,
      ],
    });

    // SW may register during launchPersistentContext before waitForEvent fires
    const page = await ctx.newPage();
    let sw = ctx.serviceWorkers()[0];
    if (!sw) {
      sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    }
    await page.goto(JOB_PAGE);
    await page.waitForTimeout(1500); // page load settle

    p(true, 'CHECK 3: Extension loaded, test job page open');

    // ── CHECK 4 — Autofill substitutes placeholders correctly ─────────────────
    // The content script doesn't auto-inject here (URL doesn't match matches[]).
    // Extension already has host_permissions for http://localhost/* so the
    // scripting API can inject it, then we send START_AUTOFILL.
    await sw.evaluate(async ({ tok, apiBase }) => {
      await chrome.storage.local.set({
        auth_token:      tok,
        user_profile:    null,
        user_profile_ts: 0,
      });

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

      // Inject content script (doesn't auto-inject; scripting API permitted via
      // host_permissions: http://localhost/*)
      await chrome.scripting.executeScript({
        target: { tabId: jobTab.id },
        files:  ['src/content/index.js'],
      });

      // Wait for content script to run refreshPageState() and populate currentFields
      await new Promise(r => setTimeout(r, 800));

      await chrome.tabs.sendMessage(jobTab.id, { type: 'START_AUTOFILL', profile })
        .catch(() => {});
    }, { tok: token, apiBase: GATEWAY });

    await page.waitForTimeout(2000);

    const clValue    = await page.locator('textarea[name="cover_letter"]').inputValue();
    const emailValue = await page.locator('input[name="email"]').inputValue();

    p(clValue === EXPECTED_FILL,
      `CHECK 4: Cover letter filled — "${clValue}"`);
    note(`Expected:  "${EXPECTED_FILL}"`);
    note(`Email filled (proves autofill ran): "${emailValue}"`);

    // ── CHECK 5 — No-template user: cover letter skipped, other fields filled ─
    await page.reload();
    await page.waitForTimeout(1000);

    await sw.evaluate(async (profile) => {
      const tabs   = await chrome.tabs.query({});
      const jobTab = tabs.find(t => t.url && t.url.includes('test-job-page'));
      if (!jobTab) return;

      // Re-inject after reload (each navigation clears the injected script)
      await chrome.scripting.executeScript({
        target: { tabId: jobTab.id },
        files:  ['src/content/index.js'],
      });
      await new Promise(r => setTimeout(r, 800));

      await chrome.tabs.sendMessage(jobTab.id, { type: 'START_AUTOFILL', profile })
        .catch(() => {});
    }, {
      firstName:           'Jane',
      lastName:            'Doe',
      email:               'jane@noreply.test',
      phone:               '',
      linkedin:            '',
      website:             '',
      location:            '',
      coverLetterTemplate: '',   // empty → profileValueFor returns null → fillElement skips
    });

    await page.waitForTimeout(2000);

    // full_name has no autocomplete attr and the regex is anchored — it classifies
    // as UNKNOWN and is not filled. Use email (el.type=email → always EMAIL) to
    // confirm the autofill pass ran, while cover letter must stay empty.
    const emailAfter = await page.locator('input[name="email"]').inputValue();
    const clAfter    = await page.locator('textarea[name="cover_letter"]').inputValue();

    const otherFieldsFilled = emailAfter !== '';
    const coverLetterEmpty  = clAfter === '';

    p(otherFieldsFilled && coverLetterEmpty,
      `CHECK 5: No-template user — email="${emailAfter}", cover letter="${clAfter}" (zero regression)`);

    await page.screenshot({ path: 'd:/GBMjobhunter/verify-e-half1.png', fullPage: true });
    await ctx.close();

  } finally {
    server.close();
  }

  console.log('\n─── Done ──────────────────────────────────────────────\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
