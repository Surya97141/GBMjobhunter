// Guards for how the Opportunities page uses AI. The page is JSX (not runnable
// under node --test without a build), so these check the source for the rules
// the behaviour depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const page    = read('../src/pages/OpportunitiesPage.jsx');
const planner = read('../src/components/opportunities/OpportunityPlanner.jsx');
const context = read('../src/context/AiSettingsContext.jsx');

// Body of `async function load()` inside the page's effect.
function loadBody() {
  const start = page.indexOf('async function load()');
  const end   = page.indexOf('load();', start);
  assert.ok(start !== -1 && end !== -1, 'load() not found');
  return page.slice(start, end);
}

test('loading the page sends nothing to an AI route', () => {
  const body = loadBody();
  assert.ok(!body.includes('/agent/'), 'page load must not call the agent service');
  assert.ok(!body.includes('client.post'), 'page load must not POST anything');
});

test('deterministic recommendations load without waiting on AI settings', () => {
  const body = loadBody();
  assert.match(body, /client\.get\(`\/opportunities\$\{skillsParam\}`\)/);
  assert.match(body, /client\.get\(`\/opportunities\/communities\$\{skillsParam\}`\)/);
  assert.ok(!/aiPayload|useAiSettings|ai\./.test(body), 'load() must not depend on AI state');
  // The skill list renders from `recommendations` alone, not gated on AI.
  assert.match(page, /recommendations\.map\(rec => \(\s*<SkillCard/);
});

test('the planner only sends after an explicit user action', () => {
  // Exactly two AI requests, each inside a handler, and no effect posts.
  const posts = planner.match(/client\.post\(/g) ?? [];
  assert.equal(posts.length, 2);
  assert.match(planner, /async function generate\(\)[\s\S]*?client\.post\('\/agent\/ai\/opportunity-plan'/);
  assert.match(planner, /async function ask\(e\)[\s\S]*?client\.post\('\/agent\/ai\/opportunity-followup'/);
  for (const effect of planner.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/g) ?? []) {
    assert.ok(!effect.includes('client.'), 'no network call inside an effect');
  }
  // It sends the finalised profile (what the preview shows), never the raw resume.
  assert.match(planner, /\{ ai: ai\.aiPayload, profile \}/);
  assert.ok(!planner.includes('raw_text'));
});

test('the page does not keep the raw resume text', () => {
  assert.match(page, /setResume\(\{ skills: parsed\.skills, workExperience: parsed\.workExperience, education: parsed\.education \}\)/);
});

test('role families are labelled as suggestions, not openings', () => {
  assert.match(planner, /not job openings/);
  assert.match(planner, /no live job listings/);
});

test('own API keys stay in memory only', () => {
  for (const src of [context, planner, page]) {
    assert.ok(!/localStorage\.setItem|sessionStorage\.\w|document\.cookie/.test(src), 'keys must not be persisted');
    assert.ok(!/console\.(log|info|debug)\(/.test(src), 'no client logging around AI requests');
  }
});
