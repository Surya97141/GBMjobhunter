// Guards for how the Insights page uses AI and external links. The components
// are JSX (not runnable under node --test without a build), so these check the
// source for the rules the behaviour depends on, like opportunitiesAi.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const page     = read('../src/pages/InsightsPage.jsx');
const personal = read('../src/components/insights/PersonalizedSearches.jsx');
const links    = read('../src/components/insights/RegionSearchLinks.jsx');
const globe    = read('../src/components/dashboard/WorldGlobe.jsx');
const boundary = read('../src/components/insights/GlobeErrorBoundary.jsx');
const opps     = read('../src/pages/OpportunitiesPage.jsx');

// Source with comments removed, so wording rules check rendered text and code only.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function functionBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, `${signature} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${signature}`);
}

test('page load sends nothing to AI and reads no resume', () => {
  assert.ok(!/client\./.test(page), 'the page itself makes no requests');
  assert.ok(!/useEffect/.test(personal), 'the personalizer has no effects that could fire on load');
  const posts = personal.match(/client\.post\(/g) ?? [];
  assert.equal(posts.length, 1, 'exactly one AI request');
  assert.match(functionBody(personal, 'async function send()'), /client\.post\('\/agent\/ai\/opportunity-plan'/);
  assert.match(functionBody(personal, 'async function startReview()'), /client\.get\('\/users\/me\/resume'\)/);
  assert.ok(!/client\.(get|post)/.test(globe.replace("client.get('/jobs/demand-supply')", '')),
    'the globe only loads the seeded demand data');
});

test('send requires a reviewed profile, an AI provider and an explicit click', () => {
  assert.match(personal, /const canSend = Boolean\(ai\.aiPayload\) && enough && \(state\.phase === 'reviewing' \|\| state\.phase === 'error'\)/);
  assert.match(functionBody(personal, 'async function send()'), /if \(!canSend \|\| sendingRef\.current\) return;/);
  assert.match(personal, /onClick=\{send\} disabled=\{!canSend\}/);
  assert.match(personal, /\{ ai: ai\.aiPayload, profile \}/, 'sends exactly the previewed profile');
  assert.match(personal, /JSON\.stringify\(profile, null, 2\)/, 'the preview shows that same object');
});

test('resume data is reduced before it reaches state, and the key is never stored or logged', () => {
  const review = functionBody(personal, 'async function startReview()');
  assert.match(review, /\{ skills: parsed\.skills, workExperience: parsed\.workExperience \}/);
  assert.ok(!/rawText|education|email|phone/.test(review));
  for (const src of [personal, links, page, globe]) {
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src), 'no persistence');
    assert.ok(!/console\.\w+\([^)]*(apiKey|aiPayload|profile)/.test(src), 'no logging of key or profile');
  }
});

test('no-AI and failure states keep the existing map and say so', () => {
  assert.match(personal, /No AI provider is available yet/);
  assert.match(personal, /The skill demand map works without AI/);
  assert.match(personal, /state\.phase === 'error'[\s\S]*role="alert"/);
  assert.match(personal, /state\.phase === 'sending'[\s\S]*role="status"/);
  assert.match(personal, /aiFailureMessage\(err\)/);
  assert.match(page, /\{searchTerms\.length > 0 && \(\s*<RegionSearchLinks/, 'search panel only after success');
  assert.match(page, /<WorldGlobe[\s\S]*searchRegions=\{regions\}/, 'the globe always renders');
});

test('search links are built locally, re-checked and opened safely', () => {
  assert.match(links, /buildRegionSearchLinks\(region, terms\)/);
  assert.match(links, /\.filter\(link => isSafeSearchUrl\(link\.url\)\)/);
  assert.match(links, /href=\{link\.url\} \{\.\.\.EXTERNAL_LINK_PROPS\}/);
  assert.equal((code(links).match(/<a /g) ?? []).length, 1, 'one link element, the checked one');
  assert.ok(!/dangerouslySetInnerHTML/.test(links + personal + page));
  assert.ok(!/href=\{[^}]*(plan|roleFamilies|res\.data)/.test(links + personal), 'model output never becomes an href');
});

test('wording: searches, not listings, and no counts or region rankings', () => {
  const text = code(links) + code(personal) + code(page);
  assert.match(links, /They are searches, not job listings/);
  assert.match(links, /not measured by\s+this app/);
  for (const banned of [/most jobs/i, /more jobs/i, /\bjobs? (?:available|found)\b/i, /\d+\s+(?:jobs|openings|listings)/i,
    /\bopen positions\b/i, /hottest/i, /best region/i]) {
    assert.ok(!banned.test(text), `banned wording ${banned}`);
  }
  assert.ok(!/openRoles|heat|applicant/.test(code(links)), 'search panel shows no demand numbers');
});

test('globe: WebGL is checked before mounting and render errors stay inside the map', () => {
  assert.match(globe, /useState\(\(\) => \(browserSupportsWebGL\(\) \? null : 'webgl'\)\)/);
  assert.match(globe, /<GlobeErrorBoundary onError=\{handleGlobeError\}/);
  assert.match(globe, /const listView = showList \|\| failure !== null;/, 'failure falls back to the list');
  assert.match(globe, /globeFailureMessage\(failure\)/);
  assert.match(globe, /globeImageUrl=\{texture === 'ready' \? GLOBE_TEXTURE_URL : null\}/);
  assert.ok(!globe.includes('//unpkg.com/three-globe/example'), 'no protocol-relative, unpinned texture');
  assert.match(page, /<GlobeErrorBoundary[\s\S]*<Suspense[\s\S]*<WorldGlobe/, 'chunk failures are caught on the page');
  assert.match(boundary, /console\.error\('\[insights\] globe failed:'/, 'errors are logged, not swallowed');
  assert.match(globe, /console\.warn\('\[insights\] skill demand data failed to load:'/);
});

test('the Opportunities page is untouched by this feature', () => {
  assert.ok(!/insights\//.test(opps));
  assert.ok(!/jobSearchLinks|globeRegions/.test(opps));
});
