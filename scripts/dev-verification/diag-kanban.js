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
  const token  = await login();
  const browser = await chromium.launch({ headless: true });

  // ── Mobile: 375px ─────────────────────────────────────────────────────────
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p375   = await ctx375.newPage();

  // Seed auth
  await p375.goto(WEB_URL);
  await p375.evaluate(t => localStorage.setItem('gbm_token', t), token);
  await p375.goto(`${WEB_URL}/dashboard/tracker`);
  await p375.waitForLoadState('networkidle');
  await p375.waitForTimeout(1000);

  // Full-page screenshot to see what's actually rendering
  await p375.screenshot({
    path:     path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'kanban-375-full.png'),
    fullPage: true,
  });

  // Viewport-only crop (what the user sees on first render)
  await p375.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'kanban-375-viewport.png'),
    clip: { x: 0, y: 0, width: 375, height: 812 },
  });

  const info375 = await p375.evaluate(() => {
    const layout  = document.querySelector('[class*="layout"]');
    const content = document.querySelector('[class*="content"]');
    const board   = document.querySelector('[class*="board"]');
    const columns = document.querySelectorAll('[class*="column"]');
    const sidebar = document.querySelector('[class*="sidebar"]');

    const lcs = layout  ? getComputedStyle(layout)  : null;
    const ccs = content ? getComputedStyle(content) : null;
    const bcs = board   ? getComputedStyle(board)   : null;
    const scs = sidebar ? getComputedStyle(sidebar) : null;

    return {
      // Page-level overflow
      pageScrollWidth:   document.documentElement.scrollWidth,
      windowInnerWidth:  window.innerWidth,
      pageOverflows:     document.documentElement.scrollWidth > window.innerWidth,

      // Layout grid
      layoutWidth:          layout  ? Math.round(layout.getBoundingClientRect().width)  : null,
      layoutGridCols:       lcs?.gridTemplateColumns,
      layoutOverflowX:      lcs?.overflowX,

      // Sidebar
      sidebarWidth:         sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      sidebarDisplay:       scs?.display,

      // Content (KanbanPage main)
      contentWidth:         content ? Math.round(content.getBoundingClientRect().width) : null,
      contentMinWidth:      ccs?.minWidth,
      contentOverflowX:     ccs?.overflowX,

      // Board
      boardScrollWidth:     board ? board.scrollWidth   : null,
      boardClientWidth:     board ? board.clientWidth   : null,
      boardOverflows:       board ? board.scrollWidth > board.clientWidth : null,
      boardOverflowX:       bcs?.overflowX,

      // Columns
      columnCount:          columns.length,
      firstColumnWidth:     columns[0] ? Math.round(columns[0].getBoundingClientRect().width) : null,
    };
  });

  console.log('=== 375px diagnostic ===');
  console.log(JSON.stringify(info375, null, 2));
  await ctx375.close();

  await browser.close();

  console.log('\nScreenshots saved:');
  console.log('  kanban-375-full.png     (full-page scroll)');
  console.log('  kanban-375-viewport.png (first screenful)');
})();
