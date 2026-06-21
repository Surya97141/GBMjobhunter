const { chromium } = require('playwright');
const path = require('path');

const WEB_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3000';
const OUT     = 'D:/GBMjobhunter/scripts/dev-verification/step14d';

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1, email: 'test@gbm.com', name: 'Alex Singh',
  target_role: 'Software Engineer', ats_score_cache: 72,
  target_location: 'London', cover_letter_template: '',
};
const MOCK_STATS = { total: 24, interviews: 5, ghosted: 11, offers: 1 };
const MOCK_INSIGHTS = [
  { id:1, pattern_type:'ghost_rate', cohort_size:1847, seen:false,
    headline:'68% of startups in your role ghosted after week 2 of no contact',
    action:'Follow up at day 10 with a specific question about the role timeline.' },
  { id:2, pattern_type:'rejection_rate', cohort_size:923, seen:false,
    headline:'Applications without a portfolio link see 3x higher rejection at screen stage',
    action:'Add one curated project link in your resume header.' },
  { id:3, pattern_type:'timing', cohort_size:2341, seen:true,
    headline:'Applications sent Tuesday–Thursday get 40% faster first responses',
    action:'Queue weekend research, apply Tuesday morning.' },
];
const MOCK_APPLICATIONS = [
  { id:1, company_name:'Stripe',  role_title:'Frontend Engineer',   status:'applied',   applied_at:'2026-06-15', ats_score:87 },
  { id:2, company_name:'Vercel',  role_title:'Software Engineer',   status:'interview', applied_at:'2026-06-10', ats_score:72 },
  { id:3, company_name:'Linear',  role_title:'Product Engineer',    status:'ghosted',   applied_at:'2026-05-28', ats_score:65 },
  { id:4, company_name:'Shopify', role_title:'Full Stack Developer', status:'offer',    applied_at:'2026-05-20', ats_score:91 },
];
const MOCK_RESUME = { data: { resume: null } };

// ─── PAGES ────────────────────────────────────────────────────────────────────

const PAGES = [
  { name: 'landing',       route: '/',                        auth: false },
  { name: 'dashboard',     route: '/dashboard',               auth: true  },
  { name: 'tracker',       route: '/dashboard/tracker',       auth: true  },
  { name: 'insights',      route: '/dashboard/insights',      auth: true  },
  { name: 'opportunities', route: '/dashboard/opportunities', auth: true  },
  { name: 'profile',       route: '/dashboard/profile',       auth: true  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function p(pass, label) { console.log(`    ${pass ? 'OK' : 'FAIL'} ${label}`); return pass; }

async function wireRoutes(page) {
  await page.route(`${API_URL}/**`, (route, req) => {
    const url = req.url();
    let body;
    if      (url.includes('/users/me/insights'))  body = { data: { insights: MOCK_INSIGHTS } };
    else if (url.includes('/users/me/resume'))    body = MOCK_RESUME;
    else if (/\/users\/me$/.test(url))            body = { data: { user: MOCK_USER } };
    else if (url.includes('/applications/stats')) body = { data: { stats: MOCK_STATS } };
    else if (url.includes('/applications'))       body = { data: { applications: MOCK_APPLICATIONS } };
    else if (url.includes('/opportunities'))      body = { data: { opportunities: [] } };
    else                                          body = { data: {} };
    route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) });
  });
}

// Collect all elements whose computed font-family resolves to Playfair Display.
// For each, return tag, abbreviated class, and font-style.
async function auditFonts(page) {
  return page.evaluate(() => {
    const HEADING_SELECTORS = 'h1, h2, h3, [class*="title"], [class*="Title"], [class*="heading"], [class*="Heading"], [class*="hero"], [class*="Hero"]';
    const candidates = document.querySelectorAll(HEADING_SELECTORS);

    const playfairEls = [];
    for (const el of candidates) {
      const cs = window.getComputedStyle(el);
      const ff = cs.fontFamily;
      if (!ff.toLowerCase().includes('playfair')) continue;
      const text = el.textContent?.trim().substring(0, 40) ?? '';
      playfairEls.push({
        tag:       el.tagName.toLowerCase(),
        cls:       (el.className?.toString() ?? '').substring(0, 50),
        fontStyle: cs.fontStyle,
        text,
      });
    }
    return playfairEls;
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=swiftshader'],
  });

  for (const theme of ['obsidian', 'cream']) {
    console.log(`\n${'═'.repeat(64)}`);
    console.log(`  THEME: ${theme.toUpperCase()}`);
    console.log('═'.repeat(64));

    for (const spec of PAGES) {
      console.log(`\n  ── ${spec.name} (${spec.route}) ──`);

      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((t) => {
        localStorage.setItem('platform-theme', t);
        // Seed token for all pages — auth guard will use it if needed, ignored otherwise
        localStorage.setItem('gbm_token', 'test-step14d');
      }, theme);

      const page = await ctx.newPage();

      // Collect console errors during page load
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 150));
      });

      // Wire API routes (harmless even for the landing page)
      await wireRoutes(page);

      await page.goto(`${WEB_URL}${spec.route}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);

      // 1. Confirm data-theme attribute
      const themeAttr = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'));
      p(themeAttr === theme, `data-theme="${themeAttr}" (expected: ${theme})`);

      // 2. Font-family check — ensure no elements use a raw system font
      //    where a theme font should be.  We look for elements using --font-heading
      //    or --font-body by checking their computed font-family.
      const fontMismatches = await page.evaluate((t) => {
        const issues = [];
        for (const el of document.querySelectorAll('*')) {
          const ff = window.getComputedStyle(el).fontFamily;
          // Flag elements that resolved to pure "serif" or "sans-serif" fallback
          // with no named font — suggests a broken font var reference
          if (ff === 'serif' || ff === 'sans-serif') {
            const tag = el.tagName.toLowerCase();
            const cls = (el.className?.toString() ?? '').substring(0, 40);
            const text = el.textContent?.trim().substring(0, 30) ?? '';
            if (text) issues.push(`<${tag} class="${cls}"> → "${ff}": "${text}"`);
          }
        }
        // Return unique by element identity (tag+class combo)
        return [...new Map(issues.map(i => [i, i])).values()].slice(0, 5);
      }, theme);

      if (fontMismatches.length === 0) {
        p(true, 'no bare fallback fonts (serif/sans-serif only)');
      } else {
        fontMismatches.forEach(m => p(false, `bare fallback font: ${m}`));
      }

      // 3. Playfair italic audit
      const playfairEls = await auditFonts(page);
      if (playfairEls.length === 0) {
        console.log(`    NOTE no Playfair heading elements found on ${spec.name}`);
      } else {
        const expectItalic = theme === 'obsidian';
        let italicOk = 0, italicWrong = 0;
        for (const el of playfairEls) {
          const isItalic = el.fontStyle === 'italic';
          if (expectItalic === isItalic) {
            italicOk++;
          } else {
            italicWrong++;
            console.log(`    FAIL <${el.tag}> "${el.text.substring(0,30)}" font-style="${el.fontStyle}" (expected: ${expectItalic ? 'italic' : 'normal'})`);
          }
        }
        if (italicWrong === 0) {
          p(true, `${italicOk} Playfair element(s): font-style correct for ${theme}`);
        }
      }

      // 4. Console errors
      if (consoleErrors.length > 0) {
        p(false, `${consoleErrors.length} console error(s) on load:`);
        consoleErrors.forEach(e => console.log(`      ⚠ ${e}`));
      } else {
        p(true, 'no console errors on load');
      }

      // 5. Full-page screenshot
      const file = `${OUT}/${theme}-${spec.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(`    Screenshot: step14d/${theme}-${spec.name}.png`);

      await ctx.close();
    }
  }

  await browser.close();
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  Done — 12 screenshots in scripts/dev-verification/step14d/');
  console.log('═'.repeat(64));
})();
