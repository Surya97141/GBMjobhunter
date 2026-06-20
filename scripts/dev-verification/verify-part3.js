const { chromium } = require('playwright');

const WEB_URL = 'http://localhost:5173';

const NEW_TOKENS = [
  '--space-1','--space-2','--space-3','--space-4',
  '--space-5','--space-6','--space-7','--space-8',
  '--radius-sm','--radius-md','--radius-lg',
  '--z-dropdown','--z-modal','--z-toast',
  '--accent-focus','--shadow-modal',
];

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }

async function checkTheme(page, theme, selector) {
  return page.evaluate(({ selector, tokens }) => {
    const el = document.querySelector(selector);
    if (!el) return { error: `element not found: ${selector}` };
    const cs = getComputedStyle(el);
    const result = {};
    tokens.forEach(t => { result[t] = cs.getPropertyValue(t).trim(); });
    return result;
  }, { selector, tokens: NEW_TOKENS });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── obsidian: LandingPage wraps everything in [data-theme="obsidian"] ────
  console.log('\n── obsidian theme ───────────────────────────────────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB_URL}/`);
    await page.waitForLoadState('networkidle');

    const vals = await checkTheme(page, 'obsidian', '[data-theme="obsidian"]');
    NEW_TOKENS.forEach(t => {
      p(!!vals[t], `${t.padEnd(18)} → "${vals[t]}"`);
    });
    await ctx.close();
  }

  // ── cream: ThemeContext sets html[data-theme="cream"] by default ──────────
  console.log('\n── cream theme ──────────────────────────────────────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB_URL}/login`);
    await page.waitForLoadState('networkidle');

    const vals = await checkTheme(page, 'cream', '[data-theme="cream"]');
    NEW_TOKENS.forEach(t => {
      p(!!vals[t], `${t.padEnd(18)} → "${vals[t]}"`);
    });
    await ctx.close();
  }

  // ── extension: inject data-theme="extension" on a div and resolve ─────────
  console.log('\n── extension theme ──────────────────────────────────────────────');
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Inject a test div with extension theme
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.setAttribute('data-theme', 'extension');
      div.id = 'ext-test';
      document.body.appendChild(div);
    });

    const vals = await checkTheme(page, 'extension', '#ext-test');
    NEW_TOKENS.forEach(t => {
      p(!!vals[t], `${t.padEnd(18)} → "${vals[t]}"`);
    });
    await ctx.close();
  }

  await browser.close();
  console.log('');
})();
