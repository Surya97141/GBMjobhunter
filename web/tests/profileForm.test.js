// Regression test for the Profile page crash on demo accounts.
//
// years_of_experience is an INTEGER column, so the API returns a number (3 for
// every demo account) or null. The suggestions panel called .trim() on the raw
// form value and threw "form[key].trim is not a function", taking the whole
// Profile page down to the error screen. These tests use the real demo profile
// and the real server-side suggestion builder, so the demo case is covered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { toFormText, initialProfileForm, buildSuggestionRows } from '../src/utils/profileForm.js';

const require = createRequire(import.meta.url);
const { DEMO_PROFILE, DEMO_RESUME } = require('../../services/user/src/demo/demoData.js');
const { buildProfileSuggestions }   = require('../../services/user/src/utils/profileSuggestions.js');

test('the demo profile really has a numeric years_of_experience (the crash trigger)', () => {
  assert.equal(typeof DEMO_PROFILE.years_of_experience, 'number');
});

test('toFormText turns numbers and null into strings', () => {
  assert.equal(toFormText(3), '3');
  assert.equal(toFormText(0), '0');
  assert.equal(toFormText(null), '');
  assert.equal(toFormText(undefined), '');
  assert.equal(toFormText('  Remote '), '  Remote ');
});

test('initial form state is all strings for the demo profile and for empty values', () => {
  const form = initialProfileForm(DEMO_PROFILE);
  for (const value of Object.values(form)) assert.equal(typeof value, 'string');
  assert.equal(form.years_of_experience, String(DEMO_PROFILE.years_of_experience));

  const empty = initialProfileForm({ years_of_experience: null, name: null });
  assert.equal(empty.years_of_experience, '');
  assert.equal(empty.name, '');
  assert.deepEqual(initialProfileForm(undefined), {
    name: '', target_role: '', target_location: '', years_of_experience: '', cover_letter_template: '',
  });
});

test('demo account: suggestion rows build without throwing, even from the raw API profile', () => {
  const suggestions = buildProfileSuggestions(DEMO_RESUME);
  assert.ok(suggestions.years_of_experience, 'the server always returns a years_of_experience row');

  // Raw API values (number) — this is exactly what crashed before.
  assert.doesNotThrow(() => buildSuggestionRows(suggestions, DEMO_PROFILE));
  // Normalised form values.
  assert.doesNotThrow(() => buildSuggestionRows(suggestions, initialProfileForm(DEMO_PROFILE)));

  const { rows } = buildSuggestionRows(suggestions, DEMO_PROFILE);
  const years = rows.find(r => r.key === 'years_of_experience');
  assert.equal(years.current, String(DEMO_PROFILE.years_of_experience));
});

test('numeric and null values compare correctly against suggestions', () => {
  const suggestions = {
    years_of_experience: { value: 3, evidence: '2021 to 2024' },
    target_role:         { value: 'Frontend Developer', evidence: 'Most recent role' },
    target_location:     { value: null, reason: 'No location found.' },
  };

  // Same number from the API and from the resume: shown as matching.
  let { rows, fillable } = buildSuggestionRows(suggestions, { years_of_experience: 3, target_role: null, target_location: null });
  assert.equal(rows.find(r => r.key === 'years_of_experience').action, 'matches');
  // null counts as empty, so the suggestion can fill it.
  assert.equal(rows.find(r => r.key === 'target_role').action, 'use');
  assert.deepEqual(fillable.map(r => r.key), ['target_role']);
  // Nothing found: no action, and the reason is kept.
  const location = rows.find(r => r.key === 'target_location');
  assert.equal(location.action, null);
  assert.equal(location.s.reason, 'No location found.');

  // A different number: offered as a replacement, never filled automatically.
  ({ rows, fillable } = buildSuggestionRows(suggestions, { years_of_experience: 5 }));
  assert.equal(rows.find(r => r.key === 'years_of_experience').action, 'replace');
  assert.ok(!fillable.some(r => r.key === 'years_of_experience'));

  // Suggested values are strings, ready for the form.
  assert.equal(rows.find(r => r.key === 'years_of_experience').suggested, '3');
});

test('no suggestions: nothing to show', () => {
  assert.deepEqual(buildSuggestionRows(null, {}), { rows: [], fillable: [] });
});
