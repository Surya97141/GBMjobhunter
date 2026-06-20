const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = 'd:\\GBMjobhunter\\scripts\\dev-verification';
const WEB = 'http://localhost:5173';
const TOKEN_KEY = 'gbm_token';

// Login once to get a token for protected routes
async function getToken() {
  const r = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
  });
  return (await r.json()).data?.token;
}

(async () => {
  const token = await getToken();
  if (!token) { console.error('Login failed'); process.exit(1); }
  console.log('Token obtained');

  const browser = await chromium.launch({ headless: true });

  const routes = [
    { path: '/',                            name: 'landing',       auth: false },
    { path: '/login',                       name: 'login',         auth: false },
    { path: '/dashboard',                   name: 'dashboard',     auth: true  },
    { path: '/dashboard/tracker',           name: 'tracker',       auth: true  },
    { path: '/dashboard/profile',           name: 'profile',       auth: true  },
    { path: '/dashboard/opportunities',     name: 'opportunities', auth: true  },
  ];

  for (const route of routes) {
    const ctx  = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();

    if (route.auth) {
      await page.goto(`${WEB}/dashboard`);
      await page.evaluate((t) => localStorage.setItem('gbm_token', t), token);
    }

    await page.goto(`${WEB}${route.path}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);  // let animations settle

    const file = path.join(OUT, `mobile-375-${route.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const finalUrl = page.url();
    console.log(`${route.name}: ${finalUrl} → ${file}`);
    await ctx.close();
  }

  await browser.close();
  console.log('Done');
})();
