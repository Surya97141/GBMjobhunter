// Personalized job-board search links on the Insights globe: what is sent to
// the AI provider, how search terms and URLs are built, and which links may be
// rendered. Run: node --test tests/globeSearch.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiProfile } from '../src/utils/aiProfile.js';
import { GLOBE_REGIONS, REGION_COORDINATES, findRegion } from '../src/utils/globeRegions.js';
import {
  buildGlobeProfile, describeGlobeProfile, sanitizeSearchTerm, deriveSearchTerms, buildSearchUrl,
  buildRegionSearchLinks, isSafeSearchUrl, EXTERNAL_LINK_PROPS, ALLOWED_SEARCH_HOSTS, JOB_BOARDS,
  MAX_SEARCH_TERMS, SEARCH_TERM_MAX, personalizeReducer, INITIAL_PERSONALIZE_STATE, termsFromPlan,
  searchableRegions,
} from '../src/utils/jobSearchLinks.js';
import {
  detectWebGL, globeFailureMessage, GLOBE_FAILURE_MESSAGES, GLOBE_TEXTURE_URL, demandLoadMessage,
} from '../src/utils/globeSupport.js';

const RESUME = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  phone: '+91 98765 43210',
  location: 'Pune',
  links: ['https://linkedin.com/in/asha'],
  rawText: 'FULL RAW RESUME TEXT',
  skills: ['react', 'JS', 'Node.js', 'CSS'],
  workExperience: [
    { role: 'Frontend Intern', company: 'Acme Corp', startDate: '2023', endDate: '2024',
      description: 'Built React dashboards. Email asha@example.com, call +91 98765 43210' },
    { role: 'Barista', company: 'Cafe Co', startDate: '2021', endDate: '2022', description: 'Coffee' },
  ],
  education: [{ degree: 'B.Tech Computer Science', school: 'Some University', year: 2024 }],
};
const USER = { full_name: 'Asha Rao', email: 'asha@example.com', target_role: 'Frontend Developer', years_of_experience: 1 };

const london = findRegion('London');

// ── Profile privacy ──────────────────────────────────────────────────────────

test('profile: only target role, years, skills and role titles with dates are sent', () => {
  const profile = buildGlobeProfile(buildAiProfile({ resume: RESUME, user: USER }));
  assert.deepEqual(Object.keys(profile).sort(), ['achievements', 'education', 'experience', 'skills', 'targetRole', 'yearsOfExperience']);
  assert.equal(profile.targetRole, 'Frontend Developer');
  assert.equal(profile.yearsOfExperience, 1);
  assert.deepEqual(profile.skills, ['React', 'JavaScript', 'Node.js', 'CSS']);
  assert.deepEqual(profile.experience, [{ role: 'Frontend Intern', start: '2023', end: '2024', highlights: '' }]);
  assert.deepEqual(profile.education, []);
  assert.deepEqual(profile.achievements, []);
});

test('profile: no contact details, company or school names, descriptions or raw text anywhere', () => {
  const sent = JSON.stringify(buildGlobeProfile(buildAiProfile({ resume: RESUME, user: USER })));
  for (const secret of ['Asha', 'asha@example.com', '98765', 'Pune', 'linkedin', 'Acme', 'Some University',
    'B.Tech', 'dashboards', 'FULL RAW RESUME TEXT', 'Cafe Co']) {
    assert.ok(!sent.includes(secret), `"${secret}" must not be sent`);
  }
});

test('profile: hand-edited extra fields and contact details in role titles are dropped', () => {
  const profile = buildGlobeProfile({
    targetRole: 'Dev — mail me at a@b.co', skills: ['React'], email: 'x@y.z', rawText: 'raw', apiKey: 'sk-123',
    experience: [{ role: 'Engineer https://evil.example/x', highlights: 'secret project', company: 'Acme' }],
    education: [{ degree: 'MSc', year: 2020 }], achievements: ['won a prize'],
  });
  const sent = JSON.stringify(profile);
  for (const s of ['a@b.co', 'x@y.z', 'raw', 'sk-123', 'evil.example', 'secret project', 'Acme', 'MSc', 'prize']) {
    assert.ok(!sent.includes(s), `"${s}" must not be sent`);
  }
  assert.equal(profile.experience[0].role, 'Engineer');
});

test('profile preview lists every field that is sent', () => {
  const profile = buildGlobeProfile(buildAiProfile({ resume: RESUME, user: USER }));
  const rows = Object.fromEntries(describeGlobeProfile(profile).map(r => [r.label, r.value]));
  assert.equal(rows['Target role'], 'Frontend Developer');
  assert.equal(rows['Skills'], 'React, JavaScript, Node.js, CSS');
  assert.equal(rows['Past role titles'], 'Frontend Intern, 2023 to 2024');
});

// ── Search terms ─────────────────────────────────────────────────────────────

const PROFILE = { targetRole: 'Frontend Developer', skills: ['React', 'CSS', 'Node.js'] };

test('terms: target role first, then grounded role families; ungrounded ones are dropped', () => {
  const plan = { roleFamilies: [
    { name: 'Frontend engineering roles', matchingSkills: ['React', 'css'] },
    { name: 'Data science', matchingSkills: ['Python'] },           // not in profile
    { name: 'Mobile development', matchingSkills: [] },              // no evidence
    { name: 'Full-stack JavaScript', matchingSkills: ['Node.js'] },
  ] };
  assert.deepEqual(deriveSearchTerms({ profile: PROFILE, plan }), [
    'Frontend Developer', 'Frontend engineering', 'Full-stack JavaScript',
  ]);
});

test('terms: deduplicated, capped and never longer than the limit', () => {
  const plan = { roleFamilies: Array.from({ length: 6 }, (_, i) => ({ name: `Role family ${i} ${'x'.repeat(80)}`, matchingSkills: ['React'] })) };
  const terms = deriveSearchTerms({ profile: { targetRole: 'frontend developer', skills: ['React'] }, plan: {
    roleFamilies: [{ name: 'Frontend Developer', matchingSkills: ['React'] }, ...plan.roleFamilies] } });
  assert.equal(terms.length, MAX_SEARCH_TERMS);
  assert.equal(terms.filter(t => t.toLowerCase() === 'frontend developer').length, 1);
  assert.ok(terms.every(t => t.length <= SEARCH_TERM_MAX));
});

test('terms: model text cannot smuggle links, markup or contact details', () => {
  assert.equal(sanitizeSearchTerm('Frontend <script>alert(1)</script> roles'), 'Frontend alert 1');
  assert.equal(sanitizeSearchTerm('See https://evil.example/jobs?x=1 Engineer'), 'See Engineer');
  assert.equal(sanitizeSearchTerm('javascript:alert(1)'), 'javascript alert 1');
  assert.equal(sanitizeSearchTerm('Dev a@b.com +1 415 555 0100'), 'Dev');
  assert.equal(sanitizeSearchTerm('C++ & C# developer\u0000\n'), 'C++ & C# developer');
  assert.equal(sanitizeSearchTerm(42), '');
});

test('no AI plan or no usable role families gives a clear failure, not empty links', () => {
  assert.equal(termsFromPlan(null, PROFILE).ok, false);
  const none = termsFromPlan({ roleFamilies: [{ name: 'x', matchingSkills: ['Cobol'] }] }, { targetRole: null, skills: ['React'] });
  assert.equal(none.ok, false);
  assert.match(none.message, /no role suggestions/);
  assert.deepEqual(termsFromPlan({ roleFamilies: [] }, PROFILE), { ok: true, terms: ['Frontend Developer'] });
});

// ── URL building and encoding ────────────────────────────────────────────────

test('urls: LinkedIn and Indeed searches use fixed hosts, paths and encoded params', () => {
  const li = new URL(buildSearchUrl('linkedin', 'Frontend Developer', london));
  assert.equal(li.origin + li.pathname, 'https://www.linkedin.com/jobs/search/');
  assert.equal(li.searchParams.get('keywords'), 'Frontend Developer');
  assert.equal(li.searchParams.get('location'), 'London, England, United Kingdom');

  const indeed = new URL(buildSearchUrl('indeed', 'Frontend Developer', london));
  assert.equal(indeed.origin + indeed.pathname, 'https://uk.indeed.com/jobs');
  assert.equal(indeed.searchParams.get('q'), 'Frontend Developer');
  assert.equal(indeed.searchParams.get('l'), 'London');
});

test('urls: special characters stay inside one parameter and cannot add others', () => {
  const term = 'C++ & C#/.NET dev';
  const raw = buildSearchUrl('linkedin', term, london);
  assert.ok(!raw.includes('&dev') && !raw.includes('#'), raw);
  assert.ok(raw.includes('C%2B%2B+%26+C%23%2F.NET+dev'), raw);
  const url = new URL(raw);
  assert.deepEqual([...url.searchParams.keys()], ['keywords', 'location']);
  assert.equal(url.searchParams.get('keywords'), term);
  assert.equal(url.hash, '');

  const evil = new URL(buildSearchUrl('indeed', 'dev&l=Moscow&q=x', london));
  assert.deepEqual([...evil.searchParams.keys()], ['q', 'l']);
  assert.equal(evil.searchParams.get('l'), 'London');
});

test('urls: non-ASCII locations and terms are percent-encoded', () => {
  const tokyo = buildSearchUrl('indeed', 'Ingénieur logiciel', findRegion('Tokyo'));
  assert.ok(/^[\x21-\x7e]+$/.test(tokyo), 'URL is plain ASCII');
  const url = new URL(tokyo);
  assert.equal(url.hostname, 'jp.indeed.com');
  assert.equal(url.searchParams.get('q'), 'Ingénieur logiciel');
  assert.equal(url.searchParams.get('l'), '東京都');
});

test('urls: unknown board, empty term or missing region give no link', () => {
  assert.equal(buildSearchUrl('glassdoor', 'Dev', london), null);
  assert.equal(buildSearchUrl('linkedin', '   ', london), null);
  assert.equal(buildSearchUrl('linkedin', 'Dev', null), null);
  assert.equal(buildSearchUrl('indeed', 'Dev', { ...london, indeedHost: 'evil.example' }), null);
});

test('every globe region has coordinates and builds a safe link on every board', () => {
  assert.equal(GLOBE_REGIONS.length, 12);
  for (const region of GLOBE_REGIONS) {
    assert.ok(REGION_COORDINATES[region.region], region.region);
    assert.ok(ALLOWED_SEARCH_HOSTS.has(region.indeedHost), region.indeedHost);
    const groups = buildRegionSearchLinks(region, ['Frontend Developer']);
    assert.equal(groups[0].links.length, JOB_BOARDS.length, region.region);
    assert.ok(groups[0].links.every(l => isSafeSearchUrl(l.url)));
  }
  assert.deepEqual(searchableRegions([]), []);
  assert.equal(searchableRegions(['Dev']).length, 12);
});

// ── External-link safety ─────────────────────────────────────────────────────

test('link safety: only https URLs on allowed job-board hosts pass', () => {
  assert.equal(isSafeSearchUrl('https://www.linkedin.com/jobs/search/?keywords=x'), true);
  assert.equal(isSafeSearchUrl('https://uk.indeed.com/jobs?q=x'), true);
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://www.linkedin.com/jobs/search/',
    'https://www.linkedin.com.evil.example/jobs',
    'https://evil.example/?https://www.linkedin.com',
    'https://user:pass@www.linkedin.com/jobs',
    'https://www.linkedin.com:8443/jobs',
    '//www.linkedin.com/jobs',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(isSafeSearchUrl(bad), false, String(bad));
  }
});

test('link safety: links open in a new tab without opener or referrer', () => {
  assert.equal(EXTERNAL_LINK_PROPS.target, '_blank');
  assert.deepEqual(EXTERNAL_LINK_PROPS.rel.split(' ').sort(), ['noopener', 'noreferrer']);
  assert.ok(Object.isFrozen(EXTERNAL_LINK_PROPS));
});

// ── Request state (loading / error) ──────────────────────────────────────────

test('state: review → sending → done, and a second send while sending is ignored', () => {
  let s = personalizeReducer(INITIAL_PERSONALIZE_STATE, { type: 'review' });
  assert.equal(s.phase, 'reviewing');
  s = personalizeReducer(s, { type: 'send' });
  assert.equal(s.phase, 'sending');
  assert.equal(personalizeReducer(s, { type: 'send' }), s);
  s = personalizeReducer(s, { type: 'success', terms: ['Dev'], providerLabel: 'Groq' });
  assert.deepEqual(s, { phase: 'done', terms: ['Dev'], providerLabel: 'Groq', message: '' });
});

test('state: a failure shows a message and keeps earlier search terms', () => {
  const done = { phase: 'done', terms: ['Dev'], providerLabel: 'Groq', message: '' };
  let s = personalizeReducer(personalizeReducer(done, { type: 'review' }), { type: 'send' });
  s = personalizeReducer(s, { type: 'failure', message: 'Too many AI requests.' });
  assert.equal(s.phase, 'error');
  assert.equal(s.message, 'Too many AI requests.');
  assert.deepEqual(s.terms, ['Dev']);
  assert.match(personalizeReducer(s, { type: 'failure' }).message, /failed/);
  assert.equal(personalizeReducer(s, { type: 'cancel' }).phase, 'done');
  assert.equal(personalizeReducer({ ...INITIAL_PERSONALIZE_STATE, phase: 'reviewing' }, { type: 'cancel' }).phase, 'idle');
  assert.deepEqual(personalizeReducer(s, { type: 'clear' }), INITIAL_PERSONALIZE_STATE);
});

// ── Globe support ────────────────────────────────────────────────────────────

test('webgl detection: missing, null or throwing contexts mean no WebGL', () => {
  assert.equal(detectWebGL(() => ({ getContext: (k) => (k === 'webgl2' ? {} : null) })), 'webgl2');
  assert.equal(detectWebGL(() => ({ getContext: (k) => (k === 'webgl' ? {} : null) })), 'webgl');
  assert.equal(detectWebGL(() => ({ getContext: () => null })), null);
  assert.equal(detectWebGL(() => ({ getContext: () => { throw new Error('blocked'); } })), null);
  assert.equal(detectWebGL(() => { throw new Error('no canvas'); }), null);
  assert.equal(detectWebGL(undefined), null);
});

test('failure messages explain each case and point to the list fallback', () => {
  assert.match(globeFailureMessage('webgl'), /WebGL/);
  assert.match(globeFailureMessage('webgl'), /list/);
  assert.match(globeFailureMessage('render'), /list/);
  assert.match(globeFailureMessage('chunk'), /reload/i);
  assert.equal(globeFailureMessage('unknown'), GLOBE_FAILURE_MESSAGES.render);
  assert.match(demandLoadMessage({ response: { status: 503 } }), /did not respond/);
  assert.match(demandLoadMessage({ response: { status: 401 } }), /Sign in/);
  assert.match(demandLoadMessage({}), /could not be loaded/);
});

test('texture is fetched over https from a pinned version', () => {
  assert.match(GLOBE_TEXTURE_URL, /^https:\/\/unpkg\.com\/three-globe@\d+\.\d+\.\d+\//);
});
