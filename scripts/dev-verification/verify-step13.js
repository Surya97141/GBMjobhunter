const { chromium } = require('playwright');
const path = require('path');

// Opens the popup HTML directly in a regular browser (no Chrome extension environment).
// - The !hasChrome branch in init() renders the job state with mock Stripe data.
// - For all other states, we force them via page.evaluate after load.

const POPUP_URL = `file:///d:/GBMjobhunter/extension/src/popup/index.html`;
const OUT       = 'd:\\GBMjobhunter\\scripts\\dev-verification';

// Popup spec: 360px wide, max 560px tall
const VIEWPORT = { width: 420, height: 620 }; // slightly larger than popup to see edges

function p(pass, label) { console.log(`  ${pass ? 'OK' : 'FAIL'} ${label}`); }

async function measurePopup(page) {
  return page.evaluate(() => {
    const body = document.body;
    // clientHeight = rendered height after max-height cap (what the user sees)
    // scrollHeight = full content height (may exceed clientHeight when cap is active)
    return {
      scrollWidth:   body.scrollWidth,
      clientWidth:   body.clientWidth,
      clientHeight:  body.clientHeight,
      scrollHeight:  body.scrollHeight,
      overflow:      getComputedStyle(body).overflowY,
      maxHeight:     getComputedStyle(body).maxHeight,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── STATE 1: Auth (unauthenticated) ───────────────────────────────────────
  console.log('\n══ STATE 1: Auth ══');
  {
    const ctx  = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(POPUP_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);

    // Force auth state (bypasses !hasChrome dev fallback)
    await page.evaluate(() => {
      // Hide all, show auth
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      document.getElementById('state-auth').classList.add('active');
    });
    await page.waitForTimeout(200);

    const dims = await measurePopup(page);
    p(dims.scrollWidth  <= 380, `width ${dims.scrollWidth}px ≤ 380px`);
    p(dims.clientHeight <= 560, `rendered height ${dims.clientHeight}px ≤ 560px (scrollHeight=${dims.scrollHeight}px)`);

    const hasSignIn = await page.evaluate(() =>
      !!document.getElementById('btn-signin'));
    const hasSignup = await page.evaluate(() =>
      !!document.getElementById('link-signup'));
    p(hasSignIn, 'Sign in button present');
    p(hasSignup, 'Sign up link present');

    await page.screenshot({
      path: path.join(OUT, 'step13-state-auth.png'),
      clip: { x: 0, y: 0, width: 380, height: Math.min(dims.scrollHeight + 20, 580) },
    });
    console.log('  Screenshot: step13-state-auth.png');
    await ctx.close();
  }

  // ── STATE 2: Idle (authenticated, not on job page) ────────────────────────
  console.log('\n══ STATE 2: Idle ══');
  {
    const ctx  = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(POPUP_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      // Simulate populateIdle
      const domain = document.getElementById('current-domain');
      domain.textContent = 'Currently on: linkedin.com';
      domain.style.display = '';
      document.getElementById('state-idle').classList.add('active');
    });
    await page.waitForTimeout(200);

    const dims = await measurePopup(page);
    p(dims.scrollWidth  <= 380, `width ${dims.scrollWidth}px ≤ 380px`);
    p(dims.clientHeight <= 560, `rendered height ${dims.clientHeight}px ≤ 560px (scrollHeight=${dims.scrollHeight}px)`);

    const hasHeader    = await page.evaluate(() => !!document.querySelector('#state-idle .popup-header'));
    const hasIcon      = await page.evaluate(() => !!document.querySelector('#state-idle .idle-icon'));
    const hasDomainTag = await page.evaluate(() =>
      document.getElementById('current-domain').textContent.includes('linkedin.com'));
    p(hasHeader,    'Header (GBM wordmark + avatar) present');
    p(hasIcon,      'Magnifying glass icon present');
    p(hasDomainTag, 'Current domain shown: "Currently on: linkedin.com"');

    await page.screenshot({
      path: path.join(OUT, 'step13-state-idle.png'),
      clip: { x: 0, y: 0, width: 380, height: Math.min(dims.scrollHeight + 20, 580) },
    });
    console.log('  Screenshot: step13-state-idle.png');
    await ctx.close();
  }

  // ── STATE 3: Job detected (main state) ───────────────────────────────────
  console.log('\n══ STATE 3: Job detected ══');
  {
    const ctx  = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(POPUP_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);

    // Force job state with mock Stripe data (replicates populateJob + showState)
    await page.evaluate(() => {
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));

      document.getElementById('job-company').textContent = 'Stripe';
      document.getElementById('job-role').textContent    = 'Senior Frontend Engineer';

      // ATS ring at 87: RING_C ≈ 226.19, offset = 226.19*(1-0.87) ≈ 29.40
      const fill = document.getElementById('ats-ring-fill');
      fill.setAttribute('stroke-dashoffset', '29.40');
      fill.setAttribute('stroke', '#10b981');
      const scoreText = document.getElementById('ats-score-text');
      scoreText.textContent = '87%';
      scoreText.setAttribute('fill', '#10b981');
      document.getElementById('ats-label').textContent = 'Good match';
      document.getElementById('ats-sub').textContent   = '1 skill missing';

      // Ghost score: initial "Checking…" state
      document.getElementById('ghost-label-text').textContent = 'Checking…';
      document.getElementById('ghost-why-btn').hidden = true;
      document.getElementById('ghost-reasons').hidden = true;

      document.getElementById('state-job').classList.add('active');
    });
    await page.waitForTimeout(200);

    const company = await page.evaluate(() =>
      document.getElementById('job-company').textContent);
    const role = await page.evaluate(() =>
      document.getElementById('job-role').textContent);
    p(company === 'Stripe', `Company: "${company}"`);
    p(role.includes('Frontend'), `Role: "${role}"`);

    // Check key sections present
    const hasAtsRing    = await page.evaluate(() => !!document.getElementById('ats-ring-fill'));
    const hasGhostRisk  = await page.evaluate(() => !!document.getElementById('ghost-dot'));
    const hasAutofill   = await page.evaluate(() => !!document.getElementById('btn-autofill'));
    const hasCoverLetter= await page.evaluate(() => !!document.getElementById('btn-generate-cl'));
    const hasOutreach   = await page.evaluate(() => !!document.getElementById('btn-generate-outreach'));
    const hasLog        = await page.evaluate(() => !!document.getElementById('btn-log'));
    p(hasAtsRing,     'ATS ring SVG present');
    p(hasGhostRisk,   'Ghost risk row present');
    p(hasAutofill,    'Auto-fill button present');
    p(hasCoverLetter, 'Generate cover letter button present');
    p(hasOutreach,    'Draft outreach button present');
    p(hasLog,         'Log as Applied button present');

    const dims = await measurePopup(page);
    p(dims.scrollWidth <= 380,  `width ${dims.scrollWidth}px ≤ 380px`);
    p(dims.clientHeight <= 560, `rendered height ${dims.clientHeight}px ≤ 560px (scrollHeight=${dims.scrollHeight}px, collapsed)`);

    await page.screenshot({
      path: path.join(OUT, 'step13-state-job.png'),
      clip: { x: 0, y: 0, width: 380, height: Math.min(dims.scrollHeight + 20, 580) },
    });
    console.log('  Screenshot: step13-state-job.png');

    // Also test with outreach block expanded (worst-case height)
    await page.evaluate(() => {
      const block  = document.getElementById('outreach-block');
      const textEl = document.getElementById('outreach-text');
      textEl.textContent = 'Hi Sarah,\n\nI came across the Senior Frontend Engineer role at Stripe and wanted to reach out directly. Your team\'s work on financial infrastructure tooling is genuinely compelling — particularly the recent approach to real-time payment routing. I have 4 years of experience building high-performance React interfaces at scale and would love to explore whether there\'s a fit.\n\nWould you be open to a 15-minute conversation?\n\nBest,\nAlex';
      block.hidden = false;
    });
    await page.waitForTimeout(100);

    const expandedDims = await measurePopup(page);
    p(expandedDims.clientHeight <= 560,
      `rendered height ${expandedDims.clientHeight}px ≤ 560px (scrollHeight=${expandedDims.scrollHeight}px, outreach expanded)`);
    if (expandedDims.scrollHeight > expandedDims.clientHeight) {
      console.log(`  NOTE: content overflows by ${expandedDims.scrollHeight - expandedDims.clientHeight}px — overflow-y:${expandedDims.overflow} scrollbar active`);
    }

    await page.screenshot({
      path: path.join(OUT, 'step13-state-job-outreach.png'),
      clip: { x: 0, y: 0, width: 380, height: Math.min(expandedDims.scrollHeight + 20, 580) },
    });
    console.log('  Screenshot: step13-state-job-outreach.png');
    await ctx.close();
  }

  // ── STATE 4: Filling in progress ──────────────────────────────────────────
  console.log('\n══ STATE 4: Filling in progress ══');
  {
    const ctx  = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(POPUP_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      // Simulate populateFilling
      document.getElementById('fill-sub').textContent = 'Stripe · Senior Frontend Engineer';
      document.getElementById('progress-fill').style.width = '0%';
      document.getElementById('progress-label').textContent = '0 of 5 fields';

      const list = document.getElementById('field-list');
      list.innerHTML = '';
      const fields = ['First name', 'Last name', 'Email address', 'Location', 'Cover letter'];
      fields.forEach((label, i) => {
        const li = document.createElement('li');
        li.className   = 'field-item';
        li.textContent = `○ ${label}`;
        list.appendChild(li);
      });

      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      document.getElementById('state-filling').classList.add('active');
    });
    await page.waitForTimeout(200);

    const dims = await measurePopup(page);
    p(dims.scrollWidth  <= 380, `width ${dims.scrollWidth}px ≤ 380px`);
    p(dims.clientHeight <= 560, `rendered height ${dims.clientHeight}px ≤ 560px (scrollHeight=${dims.scrollHeight}px)`);

    const hasProgress = await page.evaluate(() => !!document.querySelector('.progress-track'));
    const hasFieldList= await page.evaluate(() => !!document.getElementById('field-list'));
    const hasCancel   = await page.evaluate(() => !!document.getElementById('btn-cancel'));
    const fieldCount  = await page.evaluate(() =>
      document.querySelectorAll('#field-list .field-item').length);
    p(hasProgress,     'Progress bar present');
    p(hasFieldList,    'Field list present');
    p(hasCancel,       'Cancel button present');
    p(fieldCount === 5, `5 field items rendered (got ${fieldCount})`);

    // Simulate mid-fill progress (2 of 5 done)
    await page.evaluate(() => {
      document.getElementById('progress-fill').style.width  = '40%';
      document.getElementById('progress-label').textContent = '2 of 5 fields';
      const items = document.querySelectorAll('#field-list .field-item');
      // Mark first 2 as done
      items[0].className   = 'field-item done';
      items[0].textContent = '✓ First name';
      items[1].className   = 'field-item done';
      items[1].textContent = '✓ Last name';
      // Mark 3rd as active
      items[2].className   = 'field-item active';
      items[2].textContent = '… Email address';
    });
    await page.waitForTimeout(100);

    await page.screenshot({
      path: path.join(OUT, 'step13-state-filling.png'),
      clip: { x: 0, y: 0, width: 380, height: Math.min(dims.scrollHeight + 20, 580) },
    });
    console.log('  Screenshot: step13-state-filling.png');
    await ctx.close();
  }

  await browser.close();
  console.log('\nDone — step13-state-auth / idle / job / job-outreach / filling');
})();
