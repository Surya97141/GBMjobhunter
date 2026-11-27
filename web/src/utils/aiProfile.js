// Deterministic preprocessing of the parsed resume + profile into the compact
// profile that the "Generate personalized opportunities" request sends to the
// selected AI provider.
//
// What goes in:   target role, years of experience, normalised skills, the
//                 experience entries relevant to those skills/role (role title,
//                 dates, a short scrubbed highlight), education (degree, year)
//                 and achievements the user typed in.
// What never goes in: name, email, phone, location, links, company and school
//                 names, and the raw resume text.
// Nothing is invented: a missing field stays empty.
//
// The agent service re-applies the same rules (services/agent/src/services/ai/
// aiProfile.js) to whatever it receives, so a hand-edited request can't widen
// what reaches the provider. Keep the limits below in step with that file.

export const LIMITS = {
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

// Common spellings mapped to one canonical name, so "nodejs" and "Node.js" are
// one skill. Keys are lower-case with spaces collapsed.
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

// ── Scrubbing ────────────────────────────────────────────────────────────────

const EMAIL_RE  = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE    = /\b(?:https?:\/\/|www\.)\S+/gi;
// Bare profile links such as linkedin.com/in/someone or github.com/someone.
const DOMAIN_PATH_RE = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|io|dev|me|org|net|co|app|ai)\/\S*/gi;
// Phone-like runs. Only treated as a phone when they hold 10–15 digits, so a
// date range such as "2019 - 2021" is left alone.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{7,}\d/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

// Removes contact details and links, collapses whitespace, caps the length.
export function scrubText(value, max) {
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
  // Cut at a word boundary when one is near the limit.
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

// ── Skills ───────────────────────────────────────────────────────────────────

export function normalizeSkill(value) {
  // Scrub without truncating, so an over-long entry is dropped rather than
  // cut into a half skill.
  const text = scrubText(value, 1000);
  if (!text || text.length > LIMITS.skillLength) return '';
  const key = text.toLowerCase().replace(/\s+/g, ' ');
  return SKILL_ALIASES[key] ?? text;
}

export function normalizeSkills(values) {
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

// ── Experience ───────────────────────────────────────────────────────────────

function words(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9+#.]+/).filter(w => w.length > 1));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-term match, so a short skill such as "R" or "Go" does not match
// inside "Barista" or "good". "+" and "#" count as part of a term (C++, C#).
function mentions(haystack, term) {
  return new RegExp(`(?:^|[^a-z0-9+#])${escapeRe(term)}(?![a-z0-9+#])`).test(haystack);
}

// How many of the user's skills / target-role words an entry mentions.
function relevance(entry, skills, targetRole) {
  const haystack = `${entry.role} ${entry.highlights}`.toLowerCase();
  let score = 0;
  for (const s of skills) if (mentions(haystack, s.toLowerCase())) score += 2;
  const roleWords = words(targetRole ?? '');
  const entryWords = words(haystack);
  for (const w of roleWords) if (w.length > 2 && entryWords.has(w)) score += 1;
  return score;
}

function cleanDate(value) {
  return scrubText(value, 20);
}

// Keeps the entries that mention the user's skills or target role (in resume
// order, which is usually most recent first). If there is nothing to measure
// relevance against, keeps the first few. Company names are not included.
export function selectExperience(entries, skills, targetRole) {
  const cleaned = (Array.isArray(entries) ? entries : [])
    .map(e => ({
      role:       scrubText(e?.role, LIMITS.roleLength),
      start:      cleanDate(e?.startDate ?? e?.start),
      end:        cleanDate(e?.endDate ?? e?.end),
      highlights: scrubText(e?.description ?? e?.highlights, LIMITS.highlight),
    }))
    .filter(e => e.role || e.highlights);

  const canMeasure = skills.length > 0 || Boolean(targetRole);
  const picked = canMeasure
    ? cleaned.filter(e => relevance(e, skills, targetRole) > 0)
    : cleaned;
  return picked.slice(0, LIMITS.experience);
}

// ── Education & achievements ─────────────────────────────────────────────────

function cleanYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
}

// Degree and year only; the school name is left out.
export function selectEducation(entries) {
  const out  = [];
  const seen = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    const degree = scrubText(e?.degree, LIMITS.degree);
    if (!degree || seen.has(degree.toLowerCase())) continue;
    seen.add(degree.toLowerCase());
    out.push({ degree, year: cleanYear(e?.year) });
    if (out.length === LIMITS.education) break;
  }
  return out;
}

export function normalizeAchievements(values) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const text = scrubText(raw, LIMITS.achievement);
    if (text && !out.includes(text)) out.push(text);
    if (out.length === LIMITS.achievements) break;
  }
  return out;
}

function cleanYears(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : null;
}

// ── Public entry points ──────────────────────────────────────────────────────

// Builds the AI profile from GET /users/me/resume (`resume`) and GET /users/me
// (`user`). Either may be null. Achievements are not parsed from resumes, so
// they start empty and come only from what the user types.
export function buildAiProfile({ resume, user, achievements = [] } = {}) {
  const targetRole = scrubText(user?.target_role, LIMITS.targetRole) || null;
  const skills     = normalizeSkills(resume?.skills);
  return {
    targetRole,
    yearsOfExperience: cleanYears(user?.years_of_experience),
    skills,
    experience:   selectExperience(resume?.workExperience, skills, targetRole),
    education:    selectEducation(resume?.education),
    achievements: normalizeAchievements(achievements),
  };
}

// Re-applies every rule to a profile the user has edited in the review form.
// The result is exactly what is sent.
export function finalizeAiProfile(profile) {
  const skills     = normalizeSkills(profile?.skills);
  const targetRole = scrubText(profile?.targetRole, LIMITS.targetRole) || null;
  return {
    targetRole,
    yearsOfExperience: cleanYears(profile?.yearsOfExperience),
    skills,
    // The user already chose which entries to keep, so only re-clean them here.
    experience: (Array.isArray(profile?.experience) ? profile.experience : [])
      .map(e => ({
        role:       scrubText(e?.role, LIMITS.roleLength),
        start:      cleanDate(e?.start),
        end:        cleanDate(e?.end),
        highlights: scrubText(e?.highlights, LIMITS.highlight),
      }))
      .filter(e => e.role || e.highlights)
      .slice(0, LIMITS.experience),
    education:    selectEducation(profile?.education),
    achievements: normalizeAchievements(profile?.achievements),
  };
}

// A request needs something to reason about.
export function hasEnoughProfile(profile) {
  return Boolean(profile && (profile.skills.length > 0 || profile.targetRole));
}

// Field-by-field description for the "what will be sent" preview.
export function describeProfile(profile) {
  return [
    { label: 'Target role',         value: profile.targetRole ?? 'Not set (left empty)' },
    { label: 'Years of experience', value: profile.yearsOfExperience ?? 'Not set (left empty)' },
    { label: 'Skills',              value: profile.skills.length ? profile.skills.join(', ') : 'None' },
    { label: 'Experience',          value: profile.experience.length ? `${profile.experience.length} entr${profile.experience.length === 1 ? 'y' : 'ies'}: role, dates and a short highlight` : 'None' },
    { label: 'Education',           value: profile.education.length ? profile.education.map(e => e.year ? `${e.degree} (${e.year})` : e.degree).join('; ') : 'None' },
    { label: 'Achievements',        value: profile.achievements.length ? `${profile.achievements.length} you entered` : 'None' },
  ];
}

// ── Follow-up question limits ────────────────────────────────────────────────

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 300;

// Returns { ok: true, question } or { ok: false, message }.
export function validateQuestion(value) {
  const question = typeof value === 'string' ? value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim() : '';
  if (question.length < QUESTION_MIN) return { ok: false, message: `Write at least ${QUESTION_MIN} characters.` };
  if (question.length > QUESTION_MAX) return { ok: false, message: `Keep the question under ${QUESTION_MAX} characters.` };
  return { ok: true, question };
}

// ── Curated resources ────────────────────────────────────────────────────────

const slug = (s) => String(s ?? '').toLowerCase().replace(/[\s_]+/g, '-');

// Courses and communities for a skill gap, taken ONLY from records the
// Opportunities API already returned (curated data). Nothing is created here:
// with no matching record, the lists are empty.
export function curatedResourcesFor(skill, { recommendations = [], communities = [] } = {}) {
  const key = slug(skill);
  if (!key) return { courses: [], communities: [] };
  const rec = recommendations.find(r => slug(r.skill) === key);
  const courses = (rec?.courses ?? []).filter(c => c?.title && typeof c.url === 'string' && c.url.startsWith('https://'));
  const groups  = communities.filter(c =>
    c?.name && typeof c.joinUrl === 'string' && c.joinUrl.startsWith('https://')
    && Array.isArray(c.tags) && c.tags.some(t => slug(t) === key));
  return { courses: courses.slice(0, 3), communities: groups.slice(0, 2) };
}

// ── Response checks ──────────────────────────────────────────────────────────
// The server validates and grounds the model output; the page still checks the
// shape before rendering, so an unexpected body shows an error, not a crash.

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const strList = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');

export function readPlanResponse(data) {
  const p = data?.success === true ? data.plan : null;
  if (!p || typeof p !== 'object') return null;
  const roles = Array.isArray(p.roleFamilies) ? p.roleFamilies : null;
  const gaps  = Array.isArray(p.skillGaps) ? p.skillGaps : null;
  const steps = Array.isArray(p.nextSteps) ? p.nextSteps : null;
  if (!roles || !gaps || !steps) return null;
  if (!roles.every(r => isStr(r?.name, 100) && isStr(r?.why, 500) && strList(r?.matchingSkills))) return null;
  if (!gaps.every(g => isStr(g?.skill, 60) && isStr(g?.why, 500) && strList(g?.evidence))) return null;
  if (!steps.every(s => Number.isInteger(s?.priority) && isStr(s?.action, 400)
    && (s.relatedSkill === null || typeof s.relatedSkill === 'string'))) return null;
  if (roles.length + gaps.length + steps.length === 0) return null;
  return {
    summary: typeof p.summary === 'string' ? p.summary : '',
    roleFamilies: roles, skillGaps: gaps, nextSteps: steps,
  };
}

export function readFollowupResponse(data) {
  if (data?.success !== true || !isStr(data.answer, 1000)) return null;
  return { answer: data.answer, outOfScope: data.outOfScope === true };
}
