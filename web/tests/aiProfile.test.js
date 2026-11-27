import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiProfile, finalizeAiProfile, hasEnoughProfile, normalizeSkills, scrubText,
  validateQuestion, curatedResourcesFor, describeProfile, readPlanResponse, readFollowupResponse,
  LIMITS, QUESTION_MAX,
} from '../src/utils/aiProfile.js';

const RESUME = {
  skills: ['javascript', 'JavaScript', 'reactjs', 'React', 'nodejs', ' CSS ', 'x'.repeat(60)],
  workExperience: [
    { role: 'Web Intern', company: 'Acme Corp', startDate: 'Jun 2024', endDate: 'Aug 2024',
      description: 'Built React dashboards. Email jane.doe@example.com, call +91 98765 43210, github.com/janedoe' },
    { role: 'Barista', company: 'Cafe Uno', startDate: '2021', endDate: '2022', description: 'Made coffee.' },
  ],
  education: [
    { degree: 'B.Tech Computer Science', institution: 'Some University', year: 2025 },
    { degree: 'B.Tech Computer Science', institution: 'Some University', year: 2025 },
  ],
  raw_text: 'Jane Doe\njane.doe@example.com\n+91 98765 43210\nFull resume text...',
};
const USER = {
  name: 'Jane Doe', email: 'jane.doe@example.com', target_role: 'Frontend Developer',
  target_location: 'Pune', years_of_experience: 1,
};

test('skills are normalised, de-duplicated and bounded', () => {
  assert.deepEqual(normalizeSkills(RESUME.skills), ['JavaScript', 'React', 'Node.js', 'CSS']);
  const many = Array.from({ length: 50 }, (_, i) => `Skill${i}`);
  assert.equal(normalizeSkills(many).length, LIMITS.skills);
  assert.deepEqual(normalizeSkills('not a list'), []);
});

test('the AI profile carries no contact details, names, locations, companies or raw text', () => {
  const profile = buildAiProfile({ resume: RESUME, user: USER });
  const sent = JSON.stringify(profile);
  for (const secret of ['Jane Doe', 'jane.doe@example.com', '98765', 'github.com', 'Pune', 'Acme', 'Some University', 'Full resume text']) {
    assert.ok(!sent.includes(secret), `profile must not contain ${secret}`);
  }
  assert.deepEqual(Object.keys(profile).sort(),
    ['achievements', 'education', 'experience', 'skills', 'targetRole', 'yearsOfExperience']);
});

test('only experience relevant to the skills or target role is kept', () => {
  const profile = buildAiProfile({ resume: RESUME, user: USER });
  assert.deepEqual(profile.experience.map(e => e.role), ['Web Intern']);
  assert.equal(profile.experience[0].start, 'Jun 2024');
  assert.match(profile.experience[0].highlights, /^Built React dashboards/);
});

test('relevance matches whole skills, not fragments of other words', () => {
  const kept = (skills, description) =>
    buildAiProfile({ resume: { skills, workExperience: [{ role: 'Barista', description }] } }).experience.length;
  assert.equal(kept(['R', 'Go'], 'Served coffee to a good crowd every morning.'), 0);
  assert.equal(kept(['R'], 'Built forecasting models in R.'), 1);
  assert.equal(kept(['C'], 'Wrote C++ services.'), 0);
  assert.equal(kept(['C++'], 'Wrote C++ services.'), 1);
  assert.equal(kept(['Node.js'], 'APIs in node.js and Express.'), 1);
});

test('over-long skills are dropped, not truncated into a partial skill', () => {
  assert.deepEqual(normalizeSkills(['Advanced distributed systems design and architecture patterns', 'Go']), ['Go']);
});

test('with nothing to measure relevance against, the first entries are kept', () => {
  const profile = buildAiProfile({ resume: { workExperience: RESUME.workExperience } });
  assert.equal(profile.experience.length, 2);
});

test('education keeps degree and year only, de-duplicated', () => {
  const profile = buildAiProfile({ resume: RESUME, user: USER });
  assert.deepEqual(profile.education, [{ degree: 'B.Tech Computer Science', year: 2025 }]);
});

test('missing fields stay empty instead of being invented', () => {
  const profile = buildAiProfile({ resume: null, user: null });
  assert.deepEqual(profile, {
    targetRole: null, yearsOfExperience: null, skills: [], experience: [], education: [], achievements: [],
  });
  assert.equal(hasEnoughProfile(profile), false);
  assert.ok(describeProfile(profile).some(f => f.value === 'Not set (left empty)'));
});

test('date ranges are not mistaken for phone numbers', () => {
  assert.equal(scrubText('Intern 2019 - 2021', 100), 'Intern 2019 - 2021');
  assert.equal(scrubText('Call 555-123-4567 now', 100), 'Call now');
});

test('edits in the review form are re-cleaned before sending', () => {
  const edited = finalizeAiProfile({
    targetRole: '  Data Analyst  ',
    yearsOfExperience: '3',
    skills: ['sql', 'SQL', 'postgres'],
    experience: [{ role: 'Analyst', highlights: 'See https://me.example and me@x.io' }, { role: '', highlights: '' }],
    education: [],
    achievements: ['Top 1% on a Kaggle contest', 'Top 1% on a Kaggle contest', 'a'.repeat(400)],
    email: 'should@be.dropped',
  });
  assert.equal(edited.targetRole, 'Data Analyst');
  assert.equal(edited.yearsOfExperience, 3);
  assert.deepEqual(edited.skills, ['SQL', 'PostgreSQL']);
  assert.deepEqual(edited.experience, [{ role: 'Analyst', start: '', end: '', highlights: 'See and' }]);
  assert.equal(edited.achievements.length, 2);
  assert.ok(edited.achievements[1].length <= LIMITS.achievement);
  assert.ok(!('email' in edited));
});

test('follow-up questions are trimmed and bounded', () => {
  assert.deepEqual(validateQuestion('  Which gap first?  '), { ok: true, question: 'Which gap first?' });
  assert.equal(validateQuestion('hi').ok, false);
  assert.equal(validateQuestion('   ').ok, false);
  assert.equal(validateQuestion(undefined).ok, false);
  assert.equal(validateQuestion('q'.repeat(QUESTION_MAX)).ok, true);
  assert.equal(validateQuestion('q'.repeat(QUESTION_MAX + 1)).ok, false);
});

test('courses and communities come only from curated records that exist', () => {
  const recommendations = [
    { skill: 'typescript', courses: [
      { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/handbook/intro.html' },
      { title: 'Bad record', url: 'javascript:alert(1)' },
    ] },
  ];
  const communities = [
    { name: 'TS Community', joinUrl: 'https://example.org/ts', tags: ['typescript'] },
    { name: 'Rust Community', joinUrl: 'https://example.org/rust', tags: ['rust'] },
  ];
  const found = curatedResourcesFor('TypeScript', { recommendations, communities });
  assert.deepEqual(found.courses.map(c => c.title), ['TypeScript Handbook']);
  assert.deepEqual(found.communities.map(c => c.name), ['TS Community']);

  // A gap with no curated record gets nothing: no invented courses or links.
  assert.deepEqual(curatedResourcesFor('Kubernetes', { recommendations, communities }), { courses: [], communities: [] });
  assert.deepEqual(curatedResourcesFor('GitHub Actions', {}), { courses: [], communities: [] });
});

test('plan and follow-up responses are shape-checked before rendering', () => {
  const plan = {
    summary: 'ok',
    roleFamilies: [{ name: 'Frontend internships', why: 'Fits.', matchingSkills: ['React'] }],
    skillGaps: [{ skill: 'TypeScript', why: 'Next.', evidence: ['React'] }],
    nextSteps: [{ priority: 1, action: 'Learn it.', relatedSkill: null }],
  };
  assert.deepEqual(readPlanResponse({ success: true, plan }), plan);
  assert.equal(readPlanResponse({ success: false, error: 'timeout' }), null);
  assert.equal(readPlanResponse({ success: true, plan: { ...plan, skillGaps: 'x' } }), null);
  assert.equal(readPlanResponse({ success: true, plan: { ...plan, nextSteps: [{ priority: '1', action: 'x' }] } }), null);
  assert.equal(readPlanResponse({ success: true, plan: { roleFamilies: [], skillGaps: [], nextSteps: [] } }), null);

  assert.deepEqual(readFollowupResponse({ success: true, answer: 'Start with TS.' }), { answer: 'Start with TS.', outOfScope: false });
  assert.equal(readFollowupResponse({ success: true, answer: '' }), null);
  assert.equal(readFollowupResponse({ success: true }), null);
});
