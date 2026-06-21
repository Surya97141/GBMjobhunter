const { chromium } = require('playwright');
const path = require('path');

const WEB_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3000';
const OUT     = 'd:\\GBMjobhunter\\scripts\\dev-verification';

const MOCK_USER  = { id: 1, email: 'test@gbm.com', name: 'Alex', target_role: 'Software Engineer', ats_score_cache: 72 };
const MOCK_STATS = { total: 24, interviews: 5, ghosted: 11, offers: 1 };

function p(pass, label) { console.log(`  ${pass ? 'OK' : 'FAIL'} ${label}`); }

async function wireRoutes(page) {
  await page.route(`${API_URL}/**`, (route, request) => {
    const url = request.url();
    let body;
    if      (/\/users\/me$/.test(url))            body = { data: { user: MOCK_USER } };
    else if (url.includes('/users/me/insights'))  body = { data: { insights: [] } };
    else if (url.includes('/applications/stats')) body = { data: { stats: MOCK_STATS } };
    else if (url.includes('/applications'))       body = { data: { applications: [] } };
    else                                          body = { data: {} };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── CHECK 1: Initial state — obsidian ────────────────────────────────────
  console.log('\n══ CHECK 1: Start in obsidian ══');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('gbm_token',      'test-step14a');
      localStorage.setItem('platform-theme', 'obsidian');
    });
    const page = await ctx.newPage();
    await wireRoutes(page);
    await page.goto(`${WEB_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(theme === 'obsidian', `data-theme="${theme}" (expected: obsidian)`);

    const btnText = await page.evaluate(() => {
      const btn = document.querySelector('[class*="themeToggle"]');
      return btn?.textContent?.trim() ?? null;
    });
    // In obsidian → destination label should be "Light mode"
    p(btnText === 'Light mode', `button label "${btnText}" (expected: "Light mode" — destination convention)`);

    const ariaLabel = await page.evaluate(() =>
      document.querySelector('[class*="themeToggle"]')?.getAttribute('aria-label') ?? null);
    p(ariaLabel === 'Switch to cream theme', `aria-label "${ariaLabel}"`);

    await page.screenshot({ path: path.join(OUT, 'step14a-1-obsidian-initial.png') });
    console.log('  Screenshot: step14a-1-obsidian-initial.png');
    await ctx.close();
  }

  // ── CHECK 2: Toggle obsidian → cream, confirm DOM + localStorage ─────────
  console.log('\n══ CHECK 2: Toggle obsidian → cream ══');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('gbm_token',      'test-step14a');
      localStorage.setItem('platform-theme', 'obsidian');
    });
    const page = await ctx.newPage();
    await wireRoutes(page);
    await page.goto(`${WEB_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Click the toggle
    await page.click('[class*="themeToggle"]');
    await page.waitForTimeout(300);

    const themeAfter = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(themeAfter === 'cream', `data-theme after toggle "${themeAfter}" (expected: cream)`);

    const storedTheme = await page.evaluate(() =>
      localStorage.getItem('platform-theme'));
    p(storedTheme === 'cream', `localStorage["platform-theme"] = "${storedTheme}" (expected: cream)`);

    const btnTextAfter = await page.evaluate(() =>
      document.querySelector('[class*="themeToggle"]')?.textContent?.trim() ?? null);
    // Now in cream → destination label should be "Dark mode"
    p(btnTextAfter === 'Dark mode', `button label after toggle "${btnTextAfter}" (expected: "Dark mode")`);

    await page.screenshot({ path: path.join(OUT, 'step14a-2-after-toggle.png') });
    console.log('  Screenshot: step14a-2-after-toggle.png');
    await ctx.close();
  }

  // ── CHECK 3: Reload — obsidian persists after toggle ─────────────────────
  // addInitScript fires on every navigation including reload, so we seed only
  // the auth token here. The toggle writes the theme to localStorage, and
  // reload should read it back without the seed script overwriting it.
  console.log('\n══ CHECK 3: Reload persistence (obsidian survives) ══');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('gbm_token', 'test-step14a');
      // No theme seed — app defaults to cream; toggle will write obsidian
    });
    const page = await ctx.newPage();
    await wireRoutes(page);

    // Load (cream default) → toggle to obsidian → localStorage writes 'obsidian'
    await page.goto(`${WEB_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const startTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(startTheme === 'cream', `Start: data-theme="${startTheme}" (default cream)`);

    await page.click('[class*="themeToggle"]'); // cream → obsidian
    await page.waitForTimeout(300);

    const storedBeforeReload = await page.evaluate(() =>
      localStorage.getItem('platform-theme'));
    p(storedBeforeReload === 'obsidian', `localStorage before reload = "${storedBeforeReload}"`);

    // Reload — addInitScript sets only token (no theme key touched), so
    // getInitialTheme() reads 'obsidian' from localStorage
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const themeAfterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(themeAfterReload === 'obsidian', `data-theme after reload "${themeAfterReload}" (expected: obsidian)`);

    const storedAfterReload = await page.evaluate(() =>
      localStorage.getItem('platform-theme'));
    p(storedAfterReload === 'obsidian', `localStorage after reload = "${storedAfterReload}"`);

    const btnAfterReload = await page.evaluate(() =>
      document.querySelector('[class*="themeToggle"]')?.textContent?.trim() ?? null);
    p(btnAfterReload === 'Light mode', `button label after reload "${btnAfterReload}" (expected: "Light mode")`);

    await page.screenshot({ path: path.join(OUT, 'step14a-3-reload-obsidian.png') });
    console.log('  Screenshot: step14a-3-reload-obsidian.png');
    await ctx.close();
  }

  // ── CHECK 4: Round-trip — toggle back, reload, confirm cream persists ─────
  console.log('\n══ CHECK 4: Round-trip obsidian → cream → reload ══');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('gbm_token', 'test-step14a');
    });
    const page = await ctx.newPage();
    await wireRoutes(page);
    await page.goto(`${WEB_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Start at cream (default), toggle to obsidian
    await page.click('[class*="themeToggle"]');
    await page.waitForTimeout(300);

    const afterFirst = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(afterFirst === 'obsidian', `After 1st toggle: data-theme="${afterFirst}"`);

    // Toggle back to cream
    await page.click('[class*="themeToggle"]');
    await page.waitForTimeout(300);

    const afterSecond = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(afterSecond === 'cream', `After 2nd toggle: data-theme="${afterSecond}"`);

    const storedBeforeReload = await page.evaluate(() =>
      localStorage.getItem('platform-theme'));
    p(storedBeforeReload === 'cream', `localStorage before reload = "${storedBeforeReload}"`);

    // Reload — should survive as cream
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const afterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'));
    p(afterReload === 'cream', `After reload: data-theme="${afterReload}" (expected: cream)`);

    await page.screenshot({ path: path.join(OUT, 'step14a-4-roundtrip-cream.png') });
    console.log('  Screenshot: step14a-4-roundtrip-cream.png');
    await ctx.close();
  }

  await browser.close();
  console.log('\nDone — step14a-1 / 2 / 3 / 4');
})();
