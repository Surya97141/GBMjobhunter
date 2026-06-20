// Step 1 Phase E — cover_letter_template round-trip checks
const GATEWAY = 'http://localhost:3000';

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg) { console.log(`     ${msg}`); }

async function auth() {
  const r = await fetch(GATEWAY + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
  });
  return (await r.json()).data?.token;
}

async function main() {
  console.log('\n─── Phase E Step 1: round-trip checks ────────────────\n');

  const token = await auth();
  if (!token) { console.log('BLOCKED: no token'); return; }
  note('Token ok');

  const TEMPLATE = 'Excited to apply for {{role}} at {{company}}.';

  // ── CHECK 1: PUT sets the template ───────────────────────────────────────
  const put1 = await fetch(GATEWAY + '/users/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cover_letter_template: TEMPLATE }),
  });
  const put1Body = await put1.json();
  const stored = put1Body.data?.user?.cover_letter_template;
  p(put1.status === 200 && stored === TEMPLATE,
    `CHECK 1: PUT 200, template stored exactly — got: ${JSON.stringify(stored)}`);

  // ── CHECK 2: GET returns it with placeholders intact ─────────────────────
  const get1 = await fetch(GATEWAY + '/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const get1Body = await get1.json();
  const returned = get1Body.data?.user?.cover_letter_template;
  p(returned === TEMPLATE,
    `CHECK 2: GET returns template intact — got: ${JSON.stringify(returned)}`);

  // ── CHECK 3: Partial PUT (target_role only) does NOT wipe template ────────
  const put2 = await fetch(GATEWAY + '/users/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_role: 'Senior Engineer' }),
  });
  const put2Body = await put2.json();
  const afterPartial = put2Body.data?.user?.cover_letter_template;
  p(afterPartial === TEMPLATE,
    `CHECK 3: Partial PUT preserved template — got: ${JSON.stringify(afterPartial)}`);

  console.log('\n─── Done ──────────────────────────────────────────────\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
