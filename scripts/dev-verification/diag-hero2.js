const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    // Find the Vanta canvas (it's a direct child of the hero section)
    const heroSection = document.querySelector('section');
    const canvases = heroSection ? heroSection.querySelectorAll('canvas') : [];
    const canvasData = Array.from(canvases).map(c => {
      const cs = window.getComputedStyle(c);
      const rect = c.getBoundingClientRect();
      return {
        position: cs.position,
        zIndex:   cs.zIndex,
        opacity:  cs.opacity,
        top:      Math.round(rect.top),
        left:     Math.round(rect.left),
        width:    Math.round(rect.width),
        height:   Math.round(rect.height),
      };
    });

    // Check what element is at the exact pixel where the hero heading should be (x=187, y=180)
    const elAtCenter = document.elementFromPoint(187, 180);
    const elAtCenterInfo = elAtCenter ? {
      tag:       elAtCenter.tagName,
      className: elAtCenter.className,
      zIndex:    window.getComputedStyle(elAtCenter).zIndex,
      position:  window.getComputedStyle(elAtCenter).position,
    } : null;

    // heroContent position info
    const heroContent = heroSection?.querySelector('[class*="heroContent"]');
    const heroContentCS = heroContent ? window.getComputedStyle(heroContent) : null;

    return {
      canvases:        canvasData,
      elementAt187x180: elAtCenterInfo,
      heroContentZIndex: heroContentCS?.zIndex,
      heroContentPosition: heroContentCS?.position,
      totalChildren:   heroSection ? heroSection.childNodes.length : 0,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
