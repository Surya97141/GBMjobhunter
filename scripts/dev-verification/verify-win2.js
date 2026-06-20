const { chromium } = require('playwright');

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

  // ── CHECK 1: LandingPage CTAs ─────────────────────────────────────────────
  console.log('\n── CHECK 1 — LandingPage CTA buttons ───────────────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB_URL}/`);
    await page.waitForLoadState('networkidle');

    const btns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="ctaFilled"], [class*="ctaGhost"]'))
        .map(b => ({
          text:      b.textContent.trim(),
          type:      b.getAttribute('type'),
          ariaLabel: b.getAttribute('aria-label'),
        }));
    });

    btns.forEach(b => {
      p(b.type === 'button',  `"${b.text}" has type="button"  → ${b.type}`);
      p(!!b.ariaLabel,        `"${b.text}" has aria-label     → "${b.ariaLabel}"`);
    });

    await ctx.close();
  }

  // ── CHECK 2: KanbanCard draggable wrapper ─────────────────────────────────
  console.log('\n── CHECK 2 — KanbanCard draggable wrapper ───────────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(WEB_URL);
    await page.evaluate(t => localStorage.setItem('gbm_token', t), token);
    await page.goto(`${WEB_URL}/dashboard/tracker`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="wrapper"]'))
        .filter(el => el.getAttribute('aria-roledescription') === 'draggable card')
        .slice(0, 3)
        .map(el => ({
          role:              el.getAttribute('role'),
          ariaRoleDesc:      el.getAttribute('aria-roledescription'),
          ariaLabel:         el.getAttribute('aria-label'),
        }));
    });

    p(cards.length > 0, `Found ${cards.length} draggable card wrapper(s)`);
    if (cards[0]) {
      p(cards[0].role === 'button',                    `role="button"                  → ${cards[0].role}`);
      p(cards[0].ariaRoleDesc === 'draggable card',    `aria-roledescription           → "${cards[0].ariaRoleDesc}"`);
      p(!!cards[0].ariaLabel,                          `aria-label                     → "${cards[0].ariaLabel}"`);
    }

    await ctx.close();
  }

  // ── CHECK 3: MetricsSection motion.ul ────────────────────────────────────
  console.log('\n── CHECK 3 — MetricsSection motion.ul aria-label ────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB_URL}/`);
    await page.waitForLoadState('networkidle');

    const ul = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Key job search statistics"]');
      return el ? { tag: el.tagName, ariaLabel: el.getAttribute('aria-label') } : null;
    });

    p(!!ul,                ul ? `Element found: <${ul.tag.toLowerCase()}>` : 'Element NOT found');
    p(ul?.ariaLabel === 'Key job search statistics',
      `aria-label → "${ul?.ariaLabel}"`);

    await ctx.close();
  }

  await browser.close();
  console.log('');
})();
