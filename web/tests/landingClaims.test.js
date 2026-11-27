// Keeps the landing page's numbers tied to the code that produces them.
// MetricsSection.jsx shows rules from the backend (cohort minimums, the keyword
// match scale) rather than market statistics; if a rule changes, this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const metrics  = read('../src/pages/landing/MetricsSection.jsx');
const features = read('../src/pages/landing/FeaturesSection.jsx');

function constant(source, name) {
  const m = source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  assert.ok(m, `${name} not found`);
  return Number(m[1]);
}

test('cohort minimums shown on the landing page match the backend', () => {
  const minCohort = constant(read('../../services/intelligence/src/services/patternComputation.service.js'), 'MIN_COHORT_SIZE');
  const minGhost  = constant(read('../../services/jobs/src/services/ghostScore.service.js'), 'MIN_COHORT');
  assert.match(metrics, new RegExp(`value:\\s*'${minCohort}\\+'`));
  assert.match(metrics, new RegExp(`value:\\s*'${minGhost}\\+'`));
  assert.match(features, new RegExp(`statistically valid at ${minCohort}\\+ members`));
});

test('the keyword match is a 0-100 percentage, as the landing page says', () => {
  assert.match(read('../../services/jobs/src/utils/tfidf.js'), /Math\.round\(\(matchedWeight \/ totalWeight\) \* 100\)/);
  assert.match(metrics, /value:\s*'0–100%'/);
});

test('no unsupported claims return', () => {
  for (const phrase of ['ATS pass rate', 'across all tracked users', 'Of applications ghosted', 'Median response window']) {
    assert.ok(!metrics.includes(phrase), `MetricsSection must not claim "${phrase}"`);
  }
  // The match is one number; nothing lists missing keywords.
  assert.ok(!/gap analysis/i.test(features), 'no "Keyword Gap Analysis" claim');
  assert.ok(!/ATS Intelligence/.test(features));
});
