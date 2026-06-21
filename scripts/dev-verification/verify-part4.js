const { chromium } = require('playwright');
const path = require('path');

const WEB_URL = 'http://localhost:5173';

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=swiftshader'],
  });

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const failedRequests = [];
  page.on('requestfailed', req => {
    if (req.url().includes('spline')) failedRequests.push(req.url());
  });

  await page.goto(`${WEB_URL}/`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // Scroll the FeaturesSection into view
  await page.evaluate(() => {
    const el = document.querySelector('[class*="section"]:last-of-type') ||
               document.querySelector('ul[class*="list"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(500);

  async function getTrigger(title) {
    return page.locator(`button:has-text("${title}")`);
  }

  async function scrollToSection() {
    await page.evaluate(() => {
      // Find the CAPABILITIES overline label to locate FeaturesSection
      const labels = Array.from(document.querySelectorAll('*'));
      const overline = labels.find(el => el.textContent.trim() === 'CAPABILITIES');
      if (overline) overline.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(200);
  }

  async function inspect(label, filename) {
    // Scroll sceneContainer into view for the screenshot
    await page.evaluate(() => {
      const sc = document.querySelector('[class*="sceneContainer"]');
      if (sc) sc.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(300);

    const info = await page.evaluate(() => {
      const viewers    = document.querySelectorAll('spline-viewer');
      const containers = document.querySelectorAll('[class*="sceneContainer"]');
      return {
        viewerCount:     viewers.length,
        containerCount:  containers.length,
        viewerUrls:      Array.from(viewers).map(v => v.getAttribute('url')),
        viewerHasCanvas: Array.from(viewers).map(v => {
          const sr = v.shadowRoot;
          return sr ? !!sr.querySelector('canvas') : false;
        }),
        containerRects: Array.from(containers).map(c => {
          const r = c.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
        }),
      };
    });

    console.log(`\n── ${label} ──`);
    p(info.viewerCount === 1,    `spline-viewer count = ${info.viewerCount} (expected 1)`);
    p(info.containerCount === 1, `sceneContainer count = ${info.containerCount}`);
    p(info.containerRects[0]?.height === 200, `container height = ${info.containerRects[0]?.height}px`);
    p(info.containerRects[0]?.width  > 0,     `container width  = ${info.containerRects[0]?.width}px`);
    if (info.viewerUrls[0]) console.log(`     url: ${info.viewerUrls[0]}`);
    p(info.viewerHasCanvas[0] === true, `shadow-root canvas present`);

    // Screenshot clipped around the container
    const rect = info.containerRects[0];
    const clipY = Math.max(0, rect.top - 80);
    await page.screenshot({
      path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', filename),
      clip: { x: 0, y: clipY, width: 1280, height: 400 },
    });

    return info;
  }

  // ── ROW 1: ATS Intelligence (open by default) ─────────────────────────────
  await scrollToSection();
  await page.waitForTimeout(3000); // scene fetch
  await inspect('ROW 1 — ATS Intelligence', 'part4-row1.png');

  // ── ROW 2: Ghost Pattern Detection ───────────────────────────────────────
  console.log('\n── Switching to Row 2 ──');
  await scrollToSection();
  await (await getTrigger('Ghost Pattern Detection')).click();
  await page.waitForTimeout(3500);
  const row2 = await inspect('ROW 2 — Ghost Pattern Detection', 'part4-row2.png');
  p(row2.viewerCount === 1, `Only 1 viewer mounted (row 1 unmounted)`);

  // ── ROW 3: Cohort Insights ────────────────────────────────────────────────
  console.log('\n── Switching to Row 3 ──');
  await scrollToSection();
  await (await getTrigger('Cohort Insights')).click();
  await page.waitForTimeout(3500);
  const row3 = await inspect('ROW 3 — Cohort Insights', 'part4-row3.png');
  p(row3.viewerCount === 1, `Only 1 viewer mounted (row 2 unmounted)`);

  // ── Console errors ────────────────────────────────────────────────────────
  console.log('\n── Console errors ──');
  const splineErrors = consoleErrors.filter(e => /spline|webgl|canvas/i.test(e));
  if (splineErrors.length === 0) console.log('  ✅ No Spline/WebGL errors');
  else splineErrors.forEach(e => console.log(`  ❌ ${e}`));
  if (failedRequests.length === 0) console.log('  ✅ No failed Spline requests');
  else failedRequests.forEach(u => console.log(`  ❌ FAILED: ${u}`));

  await browser.close();
  console.log('\nScreenshots: part4-row1.png / part4-row2.png / part4-row3.png');
})();
