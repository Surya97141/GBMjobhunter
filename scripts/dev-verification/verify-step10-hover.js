const { chromium } = require('playwright');
const path = require('path');

const WEB_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3000';
const OUT     = 'd:\\GBMjobhunter\\scripts\\dev-verification';

const MOCK_USER     = { id: 1, email: 'test@gbm.com', name: 'Alex', target_role: 'Software Engineer', ats_score_cache: 72 };
const MOCK_STATS    = { total: 24, interviews: 5, ghosted: 11, offers: 1 };
const MOCK_INSIGHTS = [
  { id: 1, pattern_type: 'ghost_rate',     cohort_size: 1847, seen: false,
    headline: '68% of startups in your role ghosted after week 2 of no contact',
    action:   'Follow up at day 10 with a specific question about the role timeline, not a generic check-in.' },
  { id: 2, pattern_type: 'rejection_rate', cohort_size: 923,  seen: false,
    headline: 'Applications without a portfolio link see 3x higher rejection at screen stage',
    action:   'Add one curated project link in your resume header — not your full portfolio, one standout piece.' },
  { id: 3, pattern_type: 'timing',         cohort_size: 2341, seen: true,
    headline: 'Applications sent Tuesday-Thursday get 40% faster first responses',
    action:   'Queue weekend research, apply Tuesday morning when hiring managers clear their inbox.' },
];

function p(pass, label) { console.log(`  ${pass ? 'OK' : 'FAIL'} ${label}`); }

async function wireRoutes(page) {
  await page.route(`${API_URL}/**`, (route, request) => {
    const url = request.url();
    let body;
    if      (url.includes('/users/me/insights'))  body = { data: { insights: MOCK_INSIGHTS } };
    else if (/\/users\/me$/.test(url))            body = { data: { user: MOCK_USER } };
    else if (url.includes('/applications/stats')) body = { data: { stats: MOCK_STATS } };
    else if (url.includes('/applications'))       body = { data: { applications: [] } };
    else                                          body = { data: {} };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function buildContext(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('gbm_token',      'test-step10');
    localStorage.setItem('platform-theme', t);
  }, theme);
  const page = await ctx.newPage();
  await wireRoutes(page);
  return { ctx, page };
}

async function loadAndScroll(page) {
  await page.goto(`${WEB_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    !!(document.querySelector('[aria-label="Job search insights"]') ||
       document.querySelector('[class*="emptyState"]')),
    { timeout: 8000 }
  ).catch(() => console.log('  WARNING: InsightCards timed out'));
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Job search insights"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(400);
}

async function getCardTransform(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[aria-label="Job search insights"] li');
    if (!card) return null;
    const c = window.getComputedStyle(card);
    return {
      transform:  c.transform,
      translateY: (() => {
        // matrix(a,b,c,d,tx,ty) — ty is index 5
        const m = c.transform.match(/matrix\(([^)]+)\)/);
        if (!m) return null;
        const vals = m[1].split(',').map(Number);
        return vals[5]; // ty
      })(),
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=swiftshader'],
  });

  // ══ TEST 2 RECHECK: Obsidian hover — border AND lift ══════════════════════
  console.log('\n══ TEST 2 RECHECK: Obsidian hover ══');
  {
    const { ctx, page } = await buildContext(browser, 'obsidian');
    await loadAndScroll(page);

    // Baseline transform before hover
    const base = await getCardTransform(page);
    console.log(`  Base transform: ${base?.transform}  (ty=${base?.translateY})`);

    // Hover and wait for Framer Motion spring to settle
    const firstCard = page.locator('[aria-label="Job search insights"] li').first();
    await firstCard.hover();
    await page.waitForTimeout(500); // Framer spring settles faster than CSS transitions

    const hovered = await getCardTransform(page);
    console.log(`  Hover transform: ${hovered?.transform}  (ty=${hovered?.translateY})`);

    p(hovered?.translateY !== null && Math.round(hovered?.translateY) === -2,
      `card lifts to y=-2 on hover (ty=${hovered?.translateY})`);

    // Also confirm border colour
    const borderColor = await page.evaluate(() => {
      const card = document.querySelector('[aria-label="Job search insights"] li');
      return card ? window.getComputedStyle(card).borderColor : null;
    });
    const isAccent = borderColor?.includes('167') && borderColor?.includes('139') && borderColor?.includes('250');
    p(isAccent, `hover border = accent purple: ${borderColor}`);

    // Screenshot mid-hover (mouse is still over card)
    await page.screenshot({ path: path.join(OUT, 'step10-hover-fix-obsidian.png') });
    console.log('  Screenshot: step10-hover-fix-obsidian.png');

    await ctx.close();
  }

  // ══ TEST 3b RECHECK: Cream hover — shadow AND lift ════════════════════════
  console.log('\n══ TEST 3b RECHECK: Cream hover ══');
  {
    const { ctx, page } = await buildContext(browser, 'cream');
    await loadAndScroll(page);

    // Baseline
    const base = await page.evaluate(() => {
      const card = document.querySelector('[aria-label="Job search insights"] li');
      if (!card) return null;
      const c = window.getComputedStyle(card);
      const m = c.transform.match(/matrix\(([^)]+)\)/);
      const ty = m ? Number(m[1].split(',')[5]) : null;
      return { boxShadow: c.boxShadow, ty };
    });
    console.log(`  Base shadow (first 60): ${base?.boxShadow?.substring(0, 60)}`);
    console.log(`  Base ty: ${base?.ty}`);

    const firstCard = page.locator('[aria-label="Job search insights"] li').first();
    await firstCard.hover();
    await page.waitForTimeout(500);

    const hovered = await page.evaluate(() => {
      const card = document.querySelector('[aria-label="Job search insights"] li');
      if (!card) return null;
      const c = window.getComputedStyle(card);
      const m = c.transform.match(/matrix\(([^)]+)\)/);
      const ty = m ? Number(m[1].split(',')[5]) : null;
      return { boxShadow: c.boxShadow, ty };
    });
    console.log(`  Hover shadow (first 60): ${hovered?.boxShadow?.substring(0, 60)}`);
    console.log(`  Hover ty: ${hovered?.ty}`);

    p(hovered?.ty !== null && Math.round(hovered?.ty) === -2,
      `card lifts to y=-2 on hover (ty=${hovered?.ty})`);
    p(hovered?.boxShadow !== 'none' && hovered?.boxShadow !== base?.boxShadow,
      `shadow deepens on hover`);

    // Screenshot mid-hover
    await page.screenshot({ path: path.join(OUT, 'step10-hover-fix-cream.png') });
    console.log('  Screenshot: step10-hover-fix-cream.png');

    await ctx.close();
  }

  await browser.close();
  console.log('\nDone.');
})();
