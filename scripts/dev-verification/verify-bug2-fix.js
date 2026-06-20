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
  const token   = await login();
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page    = await ctx.newPage();

  await page.goto(WEB_URL);
  await page.evaluate(t => localStorage.setItem('gbm_token', t), token);
  await page.goto(`${WEB_URL}/dashboard/tracker`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // ── A: viewport screenshot — board visible without scrolling ──────────────
  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'bug2-viewport.png'),
    clip: { x: 0, y: 0, width: 375, height: 812 },
  });

  // ── B: scroll board to far right, screenshot — last column reachable ──────
  await page.evaluate(() => {
    const board = document.querySelector('[class*="board"]');
    if (board) board.scrollLeft = board.scrollWidth;
  });
  await page.waitForTimeout(400);

  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'bug2-scrolled-right.png'),
    fullPage: true,
  });

  // ── C: computed check ─────────────────────────────────────────────────────
  const info = await page.evaluate(() => {
    const sidebar  = document.querySelector('[class*="sidebar"]');
    const content  = document.querySelector('[class*="content"]');
    const board    = document.querySelector('[class*="board"]');
    const columns  = document.querySelectorAll('[class*="column"]');

    const scs = sidebar  ? getComputedStyle(sidebar)  : null;
    const ccs = content  ? getComputedStyle(content)  : null;
    const bcs = board    ? getComputedStyle(board)    : null;

    // Column titles visible after scrolling right
    const colTitles = Array.from(document.querySelectorAll('[class*="title"]'))
      .map(el => el.textContent.trim())
      .filter(Boolean);

    return {
      sidebarPosition:   scs?.position,
      sidebarHeight:     sidebar ? Math.round(sidebar.getBoundingClientRect().height) : null,
      contentPaddingL:   ccs?.paddingLeft,
      contentPaddingR:   ccs?.paddingRight,
      boardClientWidth:  board ? board.clientWidth : null,
      boardScrollWidth:  board ? board.scrollWidth : null,
      boardScrollLeft:   board ? Math.round(board.scrollLeft) : null,
      boardBoxShadow:    bcs?.boxShadow,
      columnCount:       columns.length,
      columnTitles:      colTitles,
      pageOverflows:     document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  console.log('=== Bug 2 fix verification ===');
  console.log(JSON.stringify(info, null, 2));

  await browser.close();

  console.log('\nScreenshots:');
  console.log('  bug2-viewport.png       — first screenful (sidebar + board visible)');
  console.log('  bug2-scrolled-right.png — board scrolled to last column');
})();
