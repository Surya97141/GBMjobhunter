const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    // Resolve --bg-primary as the hero section actually sees it
    const heroSection = document.querySelector('section');
    const heroContent = heroSection?.querySelector('[class*="heroContent"]');
    const canvas      = heroSection?.querySelector('canvas');

    const resolvedBgPrimary = heroSection
      ? getComputedStyle(heroSection).getPropertyValue('--bg-primary').trim()
      : 'not found';

    const canvasCS = canvas ? getComputedStyle(canvas) : null;
    const heroContentCS = heroContent ? getComputedStyle(heroContent) : null;

    // Check the background-color of the heroContent div itself
    return {
      resolvedBgPrimary,
      heroSectionBgColor:    getComputedStyle(heroSection).backgroundColor,
      heroContentBgColor:    heroContentCS?.backgroundColor,
      canvasBgColor:         canvasCS?.backgroundColor,
      canvasZIndex:          canvasCS?.zIndex,
      heroContentZIndex:     heroContentCS?.zIndex,
      // Does the obsidian div set --bg-primary?
      obsidianDivBgPrimary:  (() => {
        const d = document.querySelector('[data-theme="obsidian"]');
        return d ? getComputedStyle(d).getPropertyValue('--bg-primary').trim() : 'div not found';
      })(),
      // What does the html element see as --bg-primary?
      htmlBgPrimary: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
