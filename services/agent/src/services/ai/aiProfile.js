// Server-side copy of the profile rules in web/src/utils/aiProfile.js. The web
// app shows the user exactly what it will send; this file re-applies the same
// rules to whatever actually arrives, so a hand-crafted request cannot get
// contact details, links, raw resume text or oversized fields to a provider.
// (The web app is ESM built by Vite and this service is CommonJS, so the two
// copies are kept in step by hand. Keep LIMITS identical.)

const { z } = require('zod');

const LIMITS = {
  skills:       30,
  skillLength:  40,
  experience:   4,
  roleLength:   80,
  highlight:    240,
  education:    3,
  degree:       120,
  achievements: 5,
  achievement:  160,
  targetRole:   80,
};

const SKILL_ALIASES = {
  'js': 'JavaScript', 'javascript': 'JavaScript',
  'ts': 'TypeScript', 'typescript': 'TypeScript',
  'node': 'Node.js', 'nodejs': 'Node.js', 'node.js': 'Node.js', 'node js': 'Node.js',
  'react': 'React', 'reactjs': 'React', 'react.js': 'React', 'react js': 'React',
  'vue': 'Vue', 'vuejs': 'Vue', 'vue.js': 'Vue',
  'next': 'Next.js', 'nextjs': 'Next.js', 'next.js': 'Next.js',
  'express': 'Express', 'expressjs': 'Express', 'express.js': 'Express',
  'postgres': 'PostgreSQL', 'postgresql': 'PostgreSQL',
  'mongo': 'MongoDB', 'mongodb': 'MongoDB',
  'k8s': 'Kubernetes', 'kubernetes': 'Kubernetes',
  'golang': 'Go',
  'py': 'Python', 'python': 'Python',
  'sql': 'SQL', 'html': 'HTML', 'css': 'CSS', 'aws': 'AWS', 'gcp': 'GCP',
  'ci/cd': 'CI/CD', 'cicd': 'CI/CD',
  'ml': 'Machine Learning', 'machine learning': 'Machine Learning',
  'sklearn': 'scikit-learn', 'scikit-learn': 'scikit-learn',
};

const EMAIL_RE  = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE    = /\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN_PATH_RE = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|io|dev|me|org|net|co|app|ai)\/\S*/gi;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{7,}\d/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function scrubText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(CONTROL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(DOMAIN_PATH_RE, ' ')
    .replace(PHONE_CANDIDATE_RE, (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 10 && digits <= 15 ? ' ' : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function normalizeSkill(value) {
  // Scrub without truncating, so an over-long entry is dropped, not cut.
  const text = scrubText(value, 1000);
  if (!text || text.length > LIMITS.skillLength) return '';
  const key = text.toLowerCase().replace(/\s+/g, ' ');
  return SKILL_ALIASES[key] ?? text;
}

function normalizeSkills(values) {
  const out  = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const skill = normalizeSkill(raw);
    const key   = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
    if (out.length === LIMITS.skills) break;
  }
  return out;
}

function cleanYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
}

function cleanYears(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : null;
}

// Request shape: generous bounds (the rules below trim further); anything not
// listed — name, email, phone, company, rawText, links — is rejected outright.
const str = (max) => z.string().max(max);
const profileSchema = z.object({
  targetRole:        str(200).nullish(),
  yearsOfExperience: z.number().int().min(0).max(60).nullish(),
  skills:            z.array(str(100)).max(60).default([]),
  experience: z.array(z.object({
    role:       str(200).optional(),
    start:      str(40).optional(),
    end:        str(40).optional(),
    highlights: str(600).optional(),
  }).strict()).max(8).default([]),
  education: z.array(z.object({
    degree: str(300),
    year:   z.number().int().nullish(),
  }).strict()).max(6).default([]),
  achievements: z.array(str(400)).max(10).default([]),
}).strict();

// Applies every rule. Input must already match profileSchema.
function normalizeProfile(input) {
  const educationSeen = new Set();
  const education = [];
  for (const e of input.education) {
    const degree = scrubText(e.degree, LIMITS.degree);
    if (!degree || educationSeen.has(degree.toLowerCase())) continue;
    educationSeen.add(degree.toLowerCase());
    education.push({ degree, year: cleanYear(e.year) });
    if (education.length === LIMITS.education) break;
  }

  const achievements = [];
  for (const a of input.achievements) {
    const text = scrubText(a, LIMITS.achievement);
    if (text && !achievements.includes(text)) achievements.push(text);
    if (achievements.length === LIMITS.achievements) break;
  }

  return {
    targetRole:        scrubText(input.targetRole ?? '', LIMITS.targetRole) || null,
    yearsOfExperience: cleanYears(input.yearsOfExperience),
    skills:            normalizeSkills(input.skills),
    experience: input.experience
      .map(e => ({
        role:       scrubText(e.role ?? '', LIMITS.roleLength),
        start:      scrubText(e.start ?? '', 20),
        end:        scrubText(e.end ?? '', 20),
        highlights: scrubText(e.highlights ?? '', LIMITS.highlight),
      }))
      .filter(e => e.role || e.highlights)
      .slice(0, LIMITS.experience),
    education,
    achievements,
  };
}

// Returns { ok: true, profile } or { ok: false, message } (fixed messages only).
function parseProfile(raw) {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'profile has missing, unknown or oversized fields' };
  }
  const profile = normalizeProfile(parsed.data);
  if (profile.skills.length === 0 && !profile.targetRole) {
    return { ok: false, message: 'Add at least one skill or a target role before generating guidance' };
  }
  return { ok: true, profile };
}

const QUESTION_MIN = 3;
const QUESTION_MAX = 300;

function parseQuestion(value) {
  const question = typeof value === 'string' ? value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim() : '';
  if (question.length < QUESTION_MIN || question.length > QUESTION_MAX) return null;
  return question;
}

module.exports = {
  LIMITS, QUESTION_MIN, QUESTION_MAX,
  scrubText, normalizeSkills, normalizeProfile, parseProfile, parseQuestion, profileSchema,
};
