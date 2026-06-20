'use strict';
// Phase E — live Tier 2 success path: cover letter generation
// Run from project root: node verify-phase-e-live.js
// Requires Tier 2 to be configured in services/agent/.env.

const GATEWAY = 'http://localhost:3000';

function p(pass, label) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); }
function note(msg)       { console.log(`     ${msg}`); }

async function login(email, pw) {
  const r = await fetch(GATEWAY + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  return (await r.json()).data?.token;
}

async function main() {
  console.log('\n─── Phase E Live — Cover Letter Generation Success Path ──────────────\n');

  const token = await login('test@example.com', 'password123');
  if (!token) { console.log('BLOCKED: no token'); process.exit(1); }
  note('Token acquired');

  // ── CHECK 1 — API returns success: true with real generated text ───────────
  console.log('\nCHECK 1 — POST /agent/generate-cover-letter returns { success: true }');

  const res  = await fetch(GATEWAY + '/agent/generate-cover-letter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      role:           'Senior Software Engineer',
      company:        'Acme Corp',
      jobDescription: 'We are looking for a distributed systems engineer to design and own core infrastructure. You will work with Kubernetes, Kafka, and Go to build systems that serve millions of users.',
    }),
  });
  const body = await res.json();

  p(body.success === true, `success=${body.success} (was not_configured before Tier 2 configured)`);

  if (!body.success) {
    note(`Response: ${JSON.stringify(body)}`);
    console.log('\n─── BLOCKED — Tier 2 not returning success; cannot proceed ──────────\n');
    return;
  }

  const generatedText = body.data?.choices?.[0]?.message?.content ?? '';

  console.log('\n  ── Full generated cover letter ──────────────────────────────────────');
  generatedText.split('\n').forEach(line => note(line || ''));
  console.log('  ─────────────────────────────────────────────────────────────────────');
  note(`(${generatedText.length} chars)`);

  // ── CHECK 2 — Text mentions role and company (not generic boilerplate) ─────
  console.log('\nCHECK 2 — Generated text references actual role and company');

  const textLower       = generatedText.toLowerCase();
  const mentionsRole    = textLower.includes('senior software engineer');
  const mentionsCompany = textLower.includes('acme corp');

  p(mentionsRole,    'Mentions "Senior Software Engineer"');
  p(mentionsCompany, 'Mentions "Acme Corp"');

  // ── CHECK 3 — No artifacts: no JSON, no markdown fences, no placeholders ──
  console.log('\nCHECK 3 — No JSON artifacts, markdown fences, or placeholder brackets');

  const noJsonLeak   = !generatedText.includes('"role"') && !generatedText.includes('"company"');
  const noFences     = !generatedText.includes('```');
  const noPlaceholders = (
    !generatedText.includes('{{') &&
    !generatedText.includes('[[') &&
    !generatedText.includes('[Name]') &&
    !generatedText.includes('[Company]') &&
    !generatedText.includes('[Role]') &&
    !generatedText.includes('[Your')
  );

  p(noJsonLeak,    'No JSON key leakage ("role":, "company":)');
  p(noFences,      'No markdown fences (```)');
  p(noPlaceholders, 'No placeholder brackets ({{, [[, [Name], [Company], etc.)');

  // ── CHECK 4 — 3-paragraph structure ───────────────────────────────────────
  console.log('\nCHECK 4 — Reads as a real 3-paragraph cover letter (not a fragment)');

  const paragraphs = generatedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const minWords   = generatedText.split(/\s+/).filter(Boolean).length;

  p(paragraphs.length >= 3, `Has ${paragraphs.length} paragraph(s) separated by blank lines (need ≥ 3)`);
  p(minWords >= 80,         `Word count: ${minWords} (need ≥ 80 — not a one-liner)`);

  console.log('\n─── Done ──────────────────────────────────────────────\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
