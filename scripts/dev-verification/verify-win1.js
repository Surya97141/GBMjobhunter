const { chromium } = require('playwright');
const path = require('path');

const GATEWAY = 'http://localhost:3000';
const WEB_URL = 'http://localhost:5173';

async function login() {
  const r = await fetch(`${GATEWAY}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: 'test@example.com', password: 'password123' }),
  });
  return (await r.json()).data?.token;
}

(async () => {
  const token = await login();

  // ── Check raw API response first ──────────────────────────────────────────
  const oppsRes = await fetch(`${GATEWAY}/opportunities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const oppsData = await oppsRes.json();
  const recs = oppsData?.data?.recommendations ?? [];

  console.log(`\nAPI: ${recs.length} recommendation(s)`);
  recs.forEach((r, i) => {
    console.log(`  [${i}] skill="${r.skill}" dataSource="${r.dataSource}" reason=${JSON.stringify(r.reason?.slice(0,80) ?? null)}`);
  });

  const cohortRecs = recs.filter(r => r.dataSource === 'cohort' && r.reason);
  console.log(`\n  cohort+reason: ${cohortRecs.length} rec(s) → reason block should appear`);

  // ── Playwright screenshot ─────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page    = await ctx.newPage();

  await page.goto(WEB_URL);
  await page.evaluate(t => localStorage.setItem('gbm_token', t), token);
  await page.goto(`${WEB_URL}/dashboard/opportunities`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'win1-opportunities.png'),
    clip: { x: 0, y: 0, width: 700, height: 900 },
  });

  // Check rendered reason elements
  const reasonEls = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="skillReason"]');
    return Array.from(els).map(el => ({
      text:        el.textContent.trim().slice(0, 100),
      borderLeft:  getComputedStyle(el).borderLeftColor,
      borderWidth: getComputedStyle(el).borderLeftWidth,
    }));
  });

  console.log(`\nRendered .skillReason elements: ${reasonEls.length}`);
  reasonEls.forEach((el, i) => console.log(`  [${i}] border=${el.borderWidth} ${el.borderLeft}  text="${el.text}"`));

  await browser.close();
  console.log('\nScreenshot: scripts/dev-verification/win1-opportunities.png');
})();
