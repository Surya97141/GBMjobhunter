const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── A: 375px mobile — text crop ──────────────────────────────────────────
  const ctxMobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const pageMobile = await ctxMobile.newPage();
  await pageMobile.goto('http://localhost:5173/');
  await pageMobile.waitForLoadState('networkidle');
  await pageMobile.waitForTimeout(1500);

  // Crop: hero text block (top 500px covers label + heading + body + CTAs)
  await pageMobile.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'bug1-mobile-text.png'),
    clip: { x: 0, y: 0, width: 375, height: 500 },
  });

  // Verify elements are in DOM with correct styles
  const check = await pageMobile.evaluate(() => {
    const h1    = document.querySelector('.t-hero');
    const label = document.querySelector('[class*="overline"]');
    const body  = document.querySelector('.t-body');
    const btns  = document.querySelectorAll('[class*="ctaFilled"], [class*="ctaGhost"]');
    const heroLeft = document.querySelector('[class*="heroLeft"]');

    const cs  = h1 ? getComputedStyle(h1) : null;
    const lcs = heroLeft ? getComputedStyle(heroLeft) : null;

    return {
      h1Color:          cs?.color,
      h1Opacity:        cs?.opacity,
      h1Visibility:     cs?.visibility,
      heroLeftBg:       lcs?.backgroundColor,
      heroLeftWidth:    heroLeft ? Math.round(heroLeft.getBoundingClientRect().width) : null,
      heroLeftHeight:   heroLeft ? Math.round(heroLeft.getBoundingClientRect().height) : null,
      labelFound:       !!label,
      bodyFound:        !!body,
      ctaCount:         btns.length,
      ctaVisibility:    Array.from(btns).map(b => ({
        text:    b.textContent.trim(),
        display: getComputedStyle(b).display,
        opacity: getComputedStyle(b).opacity,
      })),
    };
  });

  console.log('=== Mobile (375px) computed check ===');
  console.log(JSON.stringify(check, null, 2));
  await ctxMobile.close();

  // ── B: 1280px desktop — full hero to confirm Vanta still shows in heroRight ──
  const ctxDesk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageDesk = await ctxDesk.newPage();
  await pageDesk.goto('http://localhost:5173/');
  await pageDesk.waitForLoadState('networkidle');
  await pageDesk.waitForTimeout(2000);

  // Full-height hero screenshot (800px viewport = covers the hero)
  await pageDesk.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'bug1-desktop-vanta.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });

  const deskCheck = await pageDesk.evaluate(() => {
    const heroRight = document.querySelector('[class*="heroRight"]');
    const heroLeft  = document.querySelector('[class*="heroLeft"]');
    const hrcs      = heroRight ? getComputedStyle(heroRight) : null;
    const hlcs      = heroLeft  ? getComputedStyle(heroLeft)  : null;
    const canvas    = document.querySelector('section canvas');
    const canvasRect = canvas?.getBoundingClientRect();

    // Is heroRight visible and transparent (so Vanta shows through)?
    return {
      heroRightDisplay:    hrcs?.display,
      heroRightBg:         hrcs?.backgroundColor,
      heroRightRect:       heroRight ? {
        left:   Math.round(heroRight.getBoundingClientRect().left),
        width:  Math.round(heroRight.getBoundingClientRect().width),
        height: Math.round(heroRight.getBoundingClientRect().height),
      } : null,
      heroLeftBg:          hlcs?.backgroundColor,
      heroLeftRect:        heroLeft ? {
        left:   Math.round(heroLeft.getBoundingClientRect().left),
        width:  Math.round(heroLeft.getBoundingClientRect().width),
        height: Math.round(heroLeft.getBoundingClientRect().height),
      } : null,
      canvasPresent:  !!canvas,
      canvasSize: canvasRect ? { width: Math.round(canvasRect.width), height: Math.round(canvasRect.height) } : null,
    };
  });

  console.log('\n=== Desktop (1280px) layout check ===');
  console.log(JSON.stringify(deskCheck, null, 2));
  await ctxDesk.close();

  await browser.close();

  console.log('\nScreenshots saved:');
  console.log('  Mobile text crop  → scripts/dev-verification/bug1-mobile-text.png');
  console.log('  Desktop hero full → scripts/dev-verification/bug1-desktop-vanta.png');
})();
