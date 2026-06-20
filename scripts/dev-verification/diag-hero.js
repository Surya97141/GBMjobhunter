const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const h1 = document.querySelector('.t-hero');
    if (!h1) return { error: 'no .t-hero element found' };

    const cs    = window.getComputedStyle(h1);
    const rect  = h1.getBoundingClientRect();
    const htmlTheme    = document.documentElement.getAttribute('data-theme');
    const obsidianDiv  = document.querySelector('[data-theme="obsidian"]');
    const heroSection  = document.querySelector('section');
    const heroSectionCS = heroSection ? window.getComputedStyle(heroSection) : null;

    return {
      text:            h1.textContent?.trim().slice(0, 50),
      color:           cs.color,
      bgColor:         cs.backgroundColor,
      visibility:      cs.visibility,
      opacity:         cs.opacity,
      display:         cs.display,
      overflow:        cs.overflow,
      zIndex:          cs.zIndex,
      fontSize:        cs.fontSize,
      top:             Math.round(rect.top),
      left:            Math.round(rect.left),
      width:           Math.round(rect.width),
      height:          Math.round(rect.height),
      htmlDataTheme:   htmlTheme,
      obsidianDivFound: !!obsidianDiv,
      heroSectionBg:    heroSectionCS ? heroSectionCS.backgroundColor : null,
      heroSectionOverflow: heroSectionCS ? heroSectionCS.overflow : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
