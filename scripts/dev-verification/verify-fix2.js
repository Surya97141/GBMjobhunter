const { chromium } = require('playwright');
const GATEWAY = 'http://localhost:3000';
const WEB_APP = 'http://localhost:5173';

async function main() {
  const r = await fetch(GATEWAY + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
  });
  const token = (await r.json()).data?.token;

  const ctx  = await chromium.launch({ headless: false });
  const page = await ctx.newPage();
  await page.goto(WEB_APP);
  await page.evaluate(t => localStorage.setItem('gbm_token', t), token);
  await page.goto(WEB_APP + '/dashboard/applications');
  await page.waitForTimeout(4000);

  // Read text content of first Ghost Test Corp card
  const card       = page.locator('[class*="card"]').first();
  const rawText    = (await card.textContent()).replace(/\s+/g, ' ').trim();
  const companyEl  = page.locator('[class*="company"]').first();
  const companyTxt = await companyEl.textContent();

  console.log('Card textContent:   ', JSON.stringify(rawText.slice(0, 80)));
  console.log('Company span text:  ', JSON.stringify(companyTxt));
  console.log('Starts with "GG":  ', rawText.startsWith('GG'));
  console.log('Double-letter gone:', !rawText.startsWith('GG'));

  // Confirm avatar renders the letter visually (via ::before)
  const avatarText = await page.locator('[class*="avatar"]').first().textContent();
  console.log('Avatar DOM text:   ', JSON.stringify(avatarText), '(should be empty)');

  await page.screenshot({ path: 'd:/GBMjobhunter/verify-fix2-card.png' });
  console.log('Screenshot saved: verify-fix2-card.png');
  await ctx.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
