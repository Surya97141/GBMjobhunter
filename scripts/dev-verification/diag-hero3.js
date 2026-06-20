const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Screenshot of just the hero section — first 450px of the page
  await page.screenshot({
    path: path.join('d:\\GBMjobhunter\\scripts\\dev-verification', 'hero-crop.png'),
    clip: { x: 0, y: 0, width: 375, height: 450 },
  });
  console.log('Screenshot saved: hero-crop.png');
  await browser.close();
})();
