const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Sample pixels at key positions using a canvas overlay
  const pixels = await page.evaluate(() => {
    // Draw a 1x1 portion of the current page onto an off-screen canvas
    // We can't read from a cross-origin canvas, but we CAN check element backgrounds
    // by sampling colors via getComputedStyle up the ancestor chain.
    // Instead, let's check: is the Vanta canvas WebGL context alive?
    const heroSection = document.querySelector('section');
    const canvas = heroSection?.querySelector('canvas');
    if (!canvas) return { error: 'no canvas' };

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const has2d = !!canvas.getContext('2d');

    // Try reading a pixel from WebGL at center of canvas
    let glPixel = null;
    try {
      if (gl) {
        const pixel = new Uint8Array(4);
        gl.readPixels(187, 406, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        glPixel = Array.from(pixel);
      }
    } catch (e) {
      glPixel = { error: e.message };
    }

    return {
      hasWebGLContext: !!gl,
      has2dContext: has2d,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      glPixelAtCenter: glPixel,
    };
  });

  console.log(JSON.stringify(pixels, null, 2));
  await browser.close();
})();
