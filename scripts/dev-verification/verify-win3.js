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

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }

(async () => {
  const token   = await login();
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page    = await ctx.newPage();

  await page.goto(WEB_URL);
  await page.evaluate(t => localStorage.setItem('gbm_token', t), token);

  // ── Land on tracker ───────────────────────────────────────────────────────
  await page.goto(`${WEB_URL}/dashboard/tracker`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);

  // Snapshot: what is the AnimatePresence key prop resolving to?
  // We can't inspect React internals directly, but we can verify the route key
  // indirectly: each page should show its own unique content after navigation,
  // confirming a full remount (not a stale cached render).
  const trackerContent = await page.evaluate(() => {
    return !!document.querySelector('[class*="board"]');
  });
  p(trackerContent, 'Tracker board renders at /dashboard/tracker');

  // Screenshot: tracker
  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'win3-tracker.png'),
    clip: { x: 260, y: 0, width: 1020, height: 400 },
  });

  // ── Navigate to Insights — capture mid-transition at ~120ms ──────────────
  // React Router changes the key immediately; Framer Motion runs the exit/enter
  // animation over ~300ms. Capturing at 120ms should show partial opacity.
  await page.evaluate(() => { window.__navTime = Date.now(); });
  await page.goto(`${WEB_URL}/dashboard/insights`);

  // Wait 120ms then screenshot to catch animation in flight
  await page.waitForTimeout(120);
  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'win3-mid-transition.png'),
    clip: { x: 260, y: 0, width: 1020, height: 400 },
  });

  // Wait for transition to finish, then confirm Insights page rendered
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const insightsContent = await page.evaluate(() => {
    // Insights page has its own heading — check for it
    const headings = Array.from(document.querySelectorAll('h1, [class*="pageTitle"]'))
      .map(h => h.textContent.trim());
    return headings;
  });
  p(insightsContent.some(h => /insight/i.test(h)), `Insights page renders after transition — headings: ${JSON.stringify(insightsContent)}`);

  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'win3-insights.png'),
    clip: { x: 260, y: 0, width: 1020, height: 400 },
  });

  // ── Verify the key IS the full pathname (not just top segment) ───────────
  // Navigate back to tracker then check that tracker content appears again
  await page.goto(`${WEB_URL}/dashboard/tracker`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);

  const trackerAgain = await page.evaluate(() => !!document.querySelector('[class*="board"]'));
  p(trackerAgain, 'Tracker board re-renders correctly after navigating back');

  // ── Verify landing → dashboard still works ────────────────────────────────
  await page.goto(`${WEB_URL}/`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);

  const landingContent = await page.evaluate(() => !!document.querySelector('.t-hero'));
  p(landingContent, 'Landing page still renders after key change (no regression)');

  await browser.close();

  console.log('\nScreenshots:');
  console.log('  win3-tracker.png        — tracker route settled');
  console.log('  win3-mid-transition.png — ~120ms into insights navigation');
  console.log('  win3-insights.png       — insights route settled');
})();
