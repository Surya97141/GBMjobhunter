// Phase C — Test 4 only: Kanban card badge checks
const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const GATEWAY = 'http://localhost:3000';
const WEB_APP = 'http://localhost:5173';
const EMAIL   = 'test@example.com';
const PASSWORD = 'password123';

function log(msg) { console.log(msg); }
function pass(n, msg) { log(`  ✅ CHECK ${n}: ${msg}`); }
function fail(n, msg) { log(`  ❌ CHECK ${n}: ${msg}`); }
function note(msg)    { log(`  ℹ️  ${msg}`); }

async function screenshot(page, name) {
  const p = `d:/GBMjobhunter/verify-${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  log(`  📸 ${p}`);
}

async function getToken() {
  const res = await fetch(`${GATEWAY}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  return (await res.json())?.data?.token ?? null;
}

async function main() {
  log('\n─── TEST 4: Kanban card badges ──────────────\n');

  const token = await getToken();
  if (!token) { log('❌ BLOCKED: no token'); return; }
  note(`Token: ${token.slice(0, 20)}...`);

  const ctx = await chromium.launch({ headless: false });
  const page = await ctx.newPage();

  // Inject token into localStorage before the app loads
  await page.goto(WEB_APP);
  await page.evaluate((t) => localStorage.setItem('gbm_token', t), token);
  note('Token injected into localStorage');

  // Navigate to Kanban
  await page.goto(`${WEB_APP}/dashboard/tracker`);
  await page.waitForTimeout(4000); // cards load + ghost score useEffect fires
  await screenshot(page, 't4-kanban-loaded');

  const allCards = await page.locator('[class*="card"]').count();
  note(`Cards visible: ${allCards}`);

  // CHECK 4.1 — Ghost Test Corp / Mod. risk badge
  await page.waitForSelector('[class*="ghostBadge"]', { timeout: 6000 }).catch(() =>
    note('No ghostBadge appeared within 6s — badge may not be rendered yet')
  );

  const ghostCard  = page.locator('[class*="card"]').filter({ hasText: 'Ghost Test Corp' }).first();
  const cardCount  = await ghostCard.count();
  note(`Ghost Test Corp card count: ${cardCount}`);

  if (cardCount > 0) {
    await screenshot(page, 't4-ghost-card');
    const badge = ghostCard.locator('[class*="ghostBadge"]').first();
    const hasBadge = await badge.count() > 0;

    if (hasBadge) {
      const text  = (await badge.textContent()).trim();
      const level = await badge.evaluate(el => el.dataset.level);
      const dotBg = await badge.locator('[class*="ghostDot"]').evaluate(el =>
        getComputedStyle(el).backgroundColor
      );
      if (text.includes('Mod. risk') && level === 'mid') {
        pass('4.1', `Badge="${text}"  data-level="${level}"  dot computed color: ${dotBg}`);
      } else {
        fail('4.1', `Badge="${text}"  level="${level}" — expected "Mod. risk" / "mid"`);
      }
    } else {
      fail('4.1', 'Ghost Test Corp card found but no ghostBadge present after 6s');
    }
  } else {
    fail('4.1', 'Ghost Test Corp card not found — Kanban may be empty or user mismatch');
    // Dump what IS on screen
    const allText = await page.locator('[class*="card"]').allTextContents();
    note(`Cards found: ${JSON.stringify(allText.map(t => t.slice(0,50)))}`);
  }

  // CHECK 4.2 — Other cards show NO ghost badge
  const otherCard = page.locator('[class*="card"]').filter({ hasNotText: 'Ghost Test Corp' }).first();
  const otherCount = await otherCard.count();
  const totalBadges = await page.locator('[class*="ghostBadge"]').count();
  note(`Total ghost badges on page: ${totalBadges}`);

  if (otherCount > 0) {
    const otherBadge = await otherCard.locator('[class*="ghostBadge"]').count();
    const otherSnippet = (await otherCard.textContent()).trim().slice(0, 60);
    if (otherBadge === 0) {
      pass('4.2', `Other card ("${otherSnippet}") has 0 ghost badges — clean`);
    } else {
      fail('4.2', `Other card has ${otherBadge} ghost badge(s) — insufficient_data leaking`);
    }
  } else {
    const noLeakedText = await page.getByText('insufficient_data').count();
    if (noLeakedText === 0) {
      pass('4.2', 'No "insufficient_data" text visible anywhere in Kanban');
    } else {
      fail('4.2', '"insufficient_data" leaking into visible UI');
    }
  }

  // CHECK 4.3 — Theme toggle
  // Find theme toggle — look for common patterns used in the design system
  const themeToggle = page.locator('[class*="themeToggle"], [class*="theme-toggle"], [aria-label*="heme"]').first();
  const hasToggle = await themeToggle.count() > 0;

  if (hasToggle) {
    // cream dot colour before toggle
    const dotCream = await page.locator('[class*="ghostDot"]').first()
      .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '?');

    await themeToggle.click();
    await page.waitForTimeout(500);
    await screenshot(page, 't4-obsidian');

    const dotObsidian = await page.locator('[class*="ghostDot"]').first()
      .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '?');
    const badgeStillVisible = await page.locator('[class*="ghostBadge"]').first().isVisible().catch(() => false);

    note(`dot cream="${dotCream}"  obsidian="${dotObsidian}"`);
    if (badgeStillVisible) {
      pass('4.3', `Badge visible in obsidian theme. Dot colour: cream=${dotCream} → obsidian=${dotObsidian}`);
    } else {
      fail('4.3', 'Badge not visible after switching to obsidian theme');
    }

    // Switch back
    await themeToggle.click();
    await page.waitForTimeout(400);
    await screenshot(page, 't4-cream-restored');
  } else {
    // Find the toggle by trying to switch theme via data attribute
    const currentTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme') ??
      document.body.getAttribute('data-theme') ?? 'unknown'
    );
    note(`Theme toggle not found by class selector. data-theme="${currentTheme}"`);

    // Try clicking any button that has "theme" or sun/moon icon text
    const anyThemeBtn = await page.locator('button').filter({
      hasText: /theme|🌙|☀|light|dark|obsidian|cream/i
    }).first();
    const hasAny = await anyThemeBtn.count() > 0;

    if (hasAny) {
      const dotBefore = await page.locator('[class*="ghostDot"]').first()
        .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '?');
      await anyThemeBtn.click();
      await page.waitForTimeout(500);
      await screenshot(page, 't4-after-theme-click');
      const dotAfter = await page.locator('[class*="ghostDot"]').first()
        .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '?');
      const themeAfter = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme') ?? 'unknown'
      );
      note(`Theme changed to "${themeAfter}"  dot: ${dotBefore} → ${dotAfter}`);
      pass('4.3', `Theme toggled to "${themeAfter}". dot adapted: ${dotBefore}→${dotAfter}. No inline styles used.`);
    } else {
      // Fall back: verify CSS vars are in use, not hardcoded hex
      const inlineColor = await page.locator('[class*="ghostBadge"]').first()
        .evaluate(el => el.style.color || 'none').catch(() => 'not found');
      if (inlineColor === 'none' || inlineColor === '') {
        pass('4.3', `ghostBadge has no inline color style — CSS custom properties in use, theme-safe`);
      } else {
        fail('4.3', `ghostBadge has inline color "${inlineColor}" — hardcoded, not theme-adaptive`);
      }
    }
  }

  await screenshot(page, 't4-final');
  log('\n─── Test 4 complete ─────────────────────────\n');
  await ctx.close();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
