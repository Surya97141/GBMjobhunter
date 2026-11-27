process.env.JWT_SECRET   = 'test-secret-for-jest';
process.env.DATABASE_URL = 'postgres://mock';

const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../src/db/users.db', () => ({
  findUserByEmail:   jest.fn(),
  createUser:        jest.fn(),
  findUserById:      jest.fn(),
  updateUserProfile: jest.fn(),
  saveResume:        jest.fn(),
  getResume:         jest.fn(),
}));

const app      = require('../../index');
const usersDb  = require('../../src/db/users.db');
const { buildProfileSuggestions, parseResumeDate } = require('../utils/profileSuggestions');

const NOW = new Date(Date.UTC(2026, 10, 15)); // 15 Nov 2026

const RESUME = {
  raw_text: 'Priya Sharma\npriya@example.com | +91 98765 43210\nExperience\n...',
  skills: ['React', 'Node.js'],
  workExperience: [
    { role: 'Frontend Developer', company: 'Acme', startDate: 'Jan 2023', endDate: 'Present' },
    { role: 'Junior Developer',   company: 'Beta', startDate: 'Jun 2020', endDate: 'Dec 2022' },
  ],
  education: [],
};

describe('buildProfileSuggestions', () => {
  it('reads the name from the resume header line, with the line as evidence', () => {
    const s = buildProfileSuggestions(RESUME, { now: NOW });
    expect(s.name).toEqual({ value: 'Priya Sharma', evidence: expect.stringContaining('"Priya Sharma"') });
  });

  it('suggests the most recent role (ongoing beats ended) and says where it came from', () => {
    const s = buildProfileSuggestions(RESUME, { now: NOW });
    expect(s.target_role.value).toBe('Frontend Developer');
    expect(s.target_role.evidence).toMatch(/Most recent role.*Acme.*Jan 2023–Present/);
  });

  it('estimates years of experience from the date ranges, rounding down', () => {
    // Jun 2020 – Dec 2022 (30 months) + Jan 2023 – Nov 2026 (46 months) = 76 months → 6 years
    const s = buildProfileSuggestions(RESUME, { now: NOW });
    expect(s.years_of_experience.value).toBe(6);
    expect(s.years_of_experience.evidence).toMatch(/2 date ranges/);
  });

  it('counts overlapping roles once', () => {
    const s = buildProfileSuggestions({
      workExperience: [
        { role: 'A', startDate: 'Jan 2020', endDate: 'Dec 2022' },
        { role: 'B', startDate: 'Jan 2021', endDate: 'Dec 2021' }, // inside A
      ],
    }, { now: NOW });
    expect(s.years_of_experience.value).toBe(2); // 35 months, not 46
  });

  it('never invents a location', () => {
    const s = buildProfileSuggestions(RESUME, { now: NOW });
    expect(s.target_location.value).toBeNull();
    expect(s.target_location.reason).toEqual(expect.any(String));
  });

  it('returns reasons, not values, when the resume has no evidence', () => {
    const s = buildProfileSuggestions({ raw_text: 'Senior Software Engineer\nSkills: React', workExperience: [] }, { now: NOW });
    expect(s.name).toEqual({ value: null, reason: expect.any(String) });
    expect(s.target_role).toEqual({ value: null, reason: expect.any(String) });
    expect(s.years_of_experience).toEqual({ value: null, reason: expect.any(String) });
  });

  it('handles a resume without raw text (e.g. the demo resume) without guessing a name', () => {
    const s = buildProfileSuggestions({ skills: ['React'] }, { now: NOW });
    expect(s.name.value).toBeNull();
  });

  it('skips roles with unreadable dates and says how many were skipped', () => {
    const s = buildProfileSuggestions({
      workExperience: [
        { role: 'A', startDate: '2019', endDate: '2021' },
        { role: 'B', startDate: 'sometime', endDate: 'later' },
      ],
    }, { now: NOW });
    expect(s.years_of_experience.value).toBe(1); // Dec 2019 → Jan 2021, counted conservatively
    expect(s.years_of_experience.evidence).toMatch(/1 role without readable dates not counted/);
  });

  it('ignores header lines that are titles, contacts or section names', () => {
    for (const header of ['Curriculum Vitae', 'Full Stack Developer', 'john@x.com', 'Experience']) {
      const s = buildProfileSuggestions({ raw_text: `${header}\nmore text` }, { now: NOW });
      expect(s.name.value).toBeNull();
    }
  });
});

describe('parseResumeDate', () => {
  it.each([
    ['Jan 2020', { year: 2020, month: 0 }],
    ['September 2019', { year: 2019, month: 8 }],
    ['2018', { year: 2018, month: undefined }],
    ['Present', { present: true }],
    ['', null],
    ['Spring 2020', null],
  ])('%s', (input, expected) => {
    expect(parseResumeDate(input)).toEqual(expected);
  });
});

describe('GET /users/me/resume', () => {
  const token = jwt.sign({ sub: 'user-1', email: 'a@b.com' }, process.env.JWT_SECRET);

  it('returns the stored resume with profile suggestions for review', async () => {
    usersDb.getResume.mockResolvedValue(RESUME);
    const res = await request(app).get('/users/me/resume').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.resume.skills).toEqual(['React', 'Node.js']);
    expect(res.body.data.profile_suggestions.target_role.value).toBe('Frontend Developer');
    expect(res.body.data.profile_suggestions.target_location.value).toBeNull();
    // Suggestions are read-only: nothing is written to the profile.
    expect(usersDb.updateUserProfile).not.toHaveBeenCalled();
  });
});
