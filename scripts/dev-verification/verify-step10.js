const { chromium } = require('playwright');
const path = require('path');

const WEB_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3000';
const OUT     = 'd:\\GBMjobhunter\\scripts\\dev-verification';

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1, email: 'test@gbm.com', name: 'Alex',
  target_role: 'Software Engineer', ats_score_cache: 72,
};
const MOCK_STATS = { total: 24, interviews: 5, ghosted: 11, offers: 1 };
const MOCK_INSIGHTS = [
  {
    id: 1, pattern_type: 'ghost_rate', cohort_size: 1847, seen: false,
    headline: '68% of startups in your role ghosted after week 2 of no contact',
    action: 'Follow up at day 10 with a specific question about the role timeline, not a generic check-in.',
  },
  {
    id: 2, pattern_type: 'rejection_rate', cohort_size: 923, seen: false,
    headline: 'Applications without a portfolio link see 3x higher rejection at screen stage',
    action: 'Add one curated project link in your resume header — not your full portfolio, one standout piece.',
  },
  {
    id: 3, pattern_type: 'timing', cohort_size: 2341, seen: true,
    headline: 'Applications sent Tuesday-Thursday get 40% faster first responses',
    action: 'Queue weekend research, apply Tuesday morning when hiring managers clear their inbox.',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function p(pass, label) { console.log(`  ${pass ? 'OK' : 'FAIL'} ${label}`); }

// Single dispatcher so URL matching is explicit — avoids glob edge cases.
async function wireRoutes(page) {
  await page.route(`${API_URL}/**`, (route, request) => {
    const url = request.url();
    let body;
    if (url.includes('/users/me/insights')) {
      body = { data: { insights: MOCK_INSIGHTS } };
    } else if (/\/users\/me$/.test(url)) {
      body = { data: { user: MOCK_USER } };
    } else if (url.includes('/applications/stats')) {
      body = { data: { stats: MOCK_STATS } };
    } else if (url.includes('/applications')) {
      body = { data: { applications: [] } };
    } else {
      body = { data: {} };
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Wait until InsightCards has finished loading (grid visible, or empty state)
async function waitForInsights(page) {
  await page.waitForFunction(() => {
    const grid  = document.querySelector('[aria-label="Job search insights"]');
    const empty = document.querySelector('[class*="emptyState"]');
    return !!(grid || empty);
  }, { timeout: 8000 }).catch(() => {
    console.log('  WARNING: InsightCards did not render within 8s');
  });
}

async function scrollToCards(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Job search insights"]')
            || document.querySelector('[class*="emptyState"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(400);
}

async function getCardStyles(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[aria-label="Job search insights"] li');
    if (!card) return null;
    const c = window.getComputedStyle(card);
    return {
      backdropFilter:  c.backdropFilter || c.webkitBackdropFilter || 'none',
      backgroundColor: c.backgroundColor,
      borderWidth:     c.borderWidth,
      borderColor:     c.borderColor,
      borderRadius:    c.borderRadius,
      boxShadow:       c.boxShadow,
      transform:       c.transform,
    };
  });
}

async function getTextStyles(page) {
  return page.evaluate(() => {
    const headline = document.querySelector('[aria-label="Job search insights"] [class*="headline"]');
    const detail   = document.querySelector('[aria-label="Job search insights"] [class*="detail"]');
    return {
      headlineColor: headline ? window.getComputedStyle(headline).color : null,
      detailColor:   detail   ? window.getComputedStyle(detail).color   : null,
      headlineText:  headline?.textContent?.slice(0, 60),
    };
  });
}

async function buildContext(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('gbm_token',      'test-step10');
    localStorage.setItem('platform-theme', t);
  }, theme);
  const page = await ctx.newPage();

  // Log API requests so we can confirm interception
  const intercepted = [];
  page.on('request', req => {
    if (req.url().startsWith(API_URL)) intercepted.push(`${req.method()} ${req.url()}`);
  });

  await wireRoutes(page);
  return { ctx, page, intercepted };
}

async function loadDashboard(page) {
  await page.goto(`${WEB_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await waitForInsights(page);
  const finalUrl = page.url();
  if (!finalUrl.includes('/dashboard')) {
    console.log(`  WARNING: redirected to ${finalUrl} — auth may have failed`);
  }
  return finalUrl;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=swiftshader'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1 + 2 + 4a — Obsidian
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 1: Obsidian card styles ══');
  {
    const { ctx, page, intercepted } = await buildContext(browser, 'obsidian');
    const finalUrl = await loadDashboard(page);
    await scrollToCards(page);

    console.log(`  Page URL: ${finalUrl}`);
    console.log(`  API requests intercepted: ${intercepted.length}`);
    intercepted.forEach(r => console.log(`    ${r}`));

    const styles = await getCardStyles(page);
    if (!styles) {
      console.log('  FAIL: No [aria-label="Job search insights"] li found.');
      const bodySnap = await page.evaluate(() => document.body.innerHTML.slice(0, 400));
      console.log('  Body preview:', bodySnap);
    } else {
      const cardCount = await page.evaluate(() =>
        document.querySelectorAll('[aria-label="Job search insights"] li').length);
      p(cardCount === 3,                            `3 insight cards rendered (got ${cardCount})`);
      p(styles.backdropFilter.includes('blur(12'), `backdrop-filter: ${styles.backdropFilter}`);
      p(styles.borderRadius === '16px',             `border-radius: ${styles.borderRadius} (expected 16px)`);
      p(styles.borderWidth !== '0px',               `glass border present (${styles.borderWidth})`);
      console.log(`  background:  ${styles.backgroundColor}`);
      console.log(`  borderColor: ${styles.borderColor}`);
      console.log(`  boxShadow:   ${styles.boxShadow}`);
    }

    await page.screenshot({ path: path.join(OUT, 'step10-obsidian.png') });
    console.log('  Screenshot: step10-obsidian.png');

    // ── TEST 2: Obsidian hover ─────────────────────────────────────────────
    console.log('\n══ TEST 2: Obsidian hover ══');
    if (styles) {
      const firstCard = page.locator('[aria-label="Job search insights"] li').first();
      await firstCard.hover();
      await page.waitForTimeout(400);

      const h = await getCardStyles(page);
      if (h) {
        const isAccent = h.borderColor.includes('167') &&
                         h.borderColor.includes('139') &&
                         h.borderColor.includes('250');
        p(isAccent, `hover border = accent purple: ${h.borderColor}`);
        const lifted = h.transform && h.transform !== 'none' &&
                       (h.transform.includes('-2)') || h.transform.includes('matrix(1, 0, 0, 1, 0, -2)'));
        p(lifted, `card lifts (transform: ${h.transform})`);
      }
      await page.screenshot({ path: path.join(OUT, 'step10-obsidian-hover.png') });
      console.log('  Screenshot: step10-obsidian-hover.png');
      await page.mouse.move(640, 100);
      await page.waitForTimeout(200);
    } else {
      console.log('  SKIP: no cards to hover');
    }

    // ── TEST 4a: Text readability (obsidian) ──────────────────────────────
    console.log('\n══ TEST 4a: Text readability (obsidian) ══');
    const text = await getTextStyles(page);
    if (text) {
      console.log(`  headline: ${text.headlineColor}  |  detail: ${text.detailColor}`);
      console.log(`  sample:   "${text.headlineText}"`);
      p(text.headlineColor && !text.headlineColor.includes('(0, 0, 0, 0)'),
        'Headline non-transparent');
    }

    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3 + 4b — Cream
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 3: Cream card styles ══');
  {
    const { ctx, page, intercepted } = await buildContext(browser, 'cream');
    const finalUrl = await loadDashboard(page);
    await scrollToCards(page);

    console.log(`  Page URL: ${finalUrl}`);
    console.log(`  API requests intercepted: ${intercepted.length}`);

    const styles = await getCardStyles(page);
    if (!styles) {
      console.log('  FAIL: No insight card in cream theme');
    } else {
      p(styles.borderWidth === '0px',  `border: none (${styles.borderWidth})`);
      p(styles.borderRadius === '16px', `border-radius: ${styles.borderRadius}`);
      p(styles.boxShadow !== 'none',    `shadow: ${styles.boxShadow.substring(0, 60)}`);
      console.log(`  background: ${styles.backgroundColor}`);
    }

    await page.screenshot({ path: path.join(OUT, 'step10-cream.png') });
    console.log('  Screenshot: step10-cream.png');

    // Cream hover
    console.log('\n══ TEST 3b: Cream hover (shadow deepens) ══');
    if (styles) {
      const baseShadow = styles.boxShadow;
      const firstCard = page.locator('[aria-label="Job search insights"] li').first();
      await firstCard.hover();
      await page.waitForTimeout(400);
      const h = await getCardStyles(page);
      p(h?.boxShadow !== 'none', `hover shadow present: ${h?.boxShadow?.substring(0, 60)}`);
      p(h?.boxShadow !== baseShadow, `shadow changed on hover`);
      await page.screenshot({ path: path.join(OUT, 'step10-cream-hover.png') });
      console.log('  Screenshot: step10-cream-hover.png');
      await page.mouse.move(640, 100);
      await page.waitForTimeout(200);
    }

    // Text readability
    console.log('\n══ TEST 4b: Text readability (cream) ══');
    const text = await getTextStyles(page);
    if (text) {
      console.log(`  headline: ${text.headlineColor}  |  detail: ${text.detailColor}`);
      p(text.headlineColor && !text.headlineColor.includes('(0, 0, 0, 0)'),
        'Headline non-transparent');
    }

    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5 — @supports fallback simulation (obsidian, blur stripped)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 5: @supports fallback (blur stripped, rgba(20,20,25,0.40) bg) ══');
  console.log('  Note: Chromium supports backdrop-filter; simulating by injecting override.');
  {
    const { ctx, page } = await buildContext(browser, 'obsidian');
    await loadDashboard(page);
    await scrollToCards(page);

    await page.addStyleTag({ content: `
      [data-theme="obsidian"] [aria-label="Job search insights"] li {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background-color: rgba(20, 20, 25, 0.40) !important;
      }
    `});
    await page.waitForTimeout(300);

    const fb = await page.evaluate(() => {
      const card     = document.querySelector('[aria-label="Job search insights"] li');
      const headline = document.querySelector('[aria-label="Job search insights"] [class*="headline"]');
      if (!card) return null;
      const cc = window.getComputedStyle(card);
      return {
        backdropFilter:  cc.backdropFilter || cc.webkitBackdropFilter || 'none',
        backgroundColor: cc.backgroundColor,
        headlineColor:   headline ? window.getComputedStyle(headline).color : null,
      };
    });

    if (fb) {
      p(fb.backdropFilter === 'none', `backdrop stripped: ${fb.backdropFilter}`);
      p(fb.backgroundColor && !fb.backgroundColor.includes('(0, 0, 0, 0)'),
        `fallback bg opaque: ${fb.backgroundColor}`);
      p(fb.headlineColor && !fb.headlineColor.includes('(0, 0, 0, 0)'),
        `headline visible on fallback: ${fb.headlineColor}`);
    } else {
      console.log('  SKIP: no cards found for fallback test');
    }

    await page.screenshot({ path: path.join(OUT, 'step10-fallback.png') });
    console.log('  Screenshot: step10-fallback.png');

    await ctx.close();
  }

  await browser.close();
  console.log('\nDone — step10-obsidian / step10-obsidian-hover / step10-cream / step10-cream-hover / step10-fallback');
})();
