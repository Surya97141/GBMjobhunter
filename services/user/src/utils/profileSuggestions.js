// Profile-field suggestions derived from a parsed resume (see resumeParser.js).
//
// Rules:
//   - A field gets a value only when the resume text contains evidence for it,
//     and the evidence is returned alongside so the user can judge it.
//   - Anything that cannot be found is returned as { value: null, reason } —
//     never guessed or filled with a default.
//   - Suggestions are never written to the profile here. The web app shows them
//     for review; the user edits and saves through the normal PUT /users/me.
//
// Shape: { [field]: { value, evidence } | { value: null, reason } }

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const PRESENT_RE = /^(present|current|now)$/i;

// Words that show a header line is a title or section, not a person's name.
const NOT_A_NAME = new Set([
  'resume', 'résumé', 'curriculum', 'vitae', 'cv', 'profile', 'summary', 'objective',
  'contact', 'email', 'phone', 'address', 'experience', 'education', 'skills',
  'engineer', 'developer', 'manager', 'designer', 'analyst', 'intern', 'student',
  'software', 'senior', 'junior', 'lead', 'scientist', 'consultant', 'architect',
  'specialist', 'full', 'stack', 'frontend', 'backend', 'data', 'web',
]);

const missing = reason => ({ value: null, reason });

function nonEmptyLines(rawText) {
  return String(rawText || '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// The name is taken only from the first few lines, and only if a line looks
// like nothing but a name (2–4 words of letters, no digits, emails or titles).
function suggestName(rawText) {
  const lines = nonEmptyLines(rawText).slice(0, 4);
  if (lines.length === 0) {
    return missing('The resume text was not available, so no name could be read.');
  }
  for (const line of lines) {
    if (line.length > 40 || /[\d@|,:/]/.test(line)) continue;
    const words = line.split(' ');
    if (words.length < 2 || words.length > 4) continue;
    // Each word must start with a capital letter: a name line is capitalised,
    // ordinary sentence fragments are not. Erring towards "not found".
    if (!words.every(w => /^\p{Lu}[\p{L}.'-]*$/u.test(w))) continue;
    if (words.some(w => NOT_A_NAME.has(w.toLowerCase().replace(/[.'-]/g, '')))) continue;
    return { value: line, evidence: `Header line of your resume: "${line}"` };
  }
  return missing('No line at the top of the resume looked like a name.');
}

// "Jan 2020", "2020", "Present" → { year, month } or { present: true } or null.
function parseResumeDate(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (PRESENT_RE.test(s)) return { present: true };
  const m = s.match(/^(?:([a-z]{3})[a-z]*\.?\s+)?((?:19|20)\d{2})$/i);
  if (!m) return null;
  const month = m[1] ? MONTHS[m[1].toLowerCase()] : undefined;
  if (m[1] && month === undefined) return null;
  return { year: Number(m[2]), month };
}

function toMonthIndex(date, now, isEnd) {
  if (date.present) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  // Without a month, count the whole year conservatively: a start year counts
  // from its December and an end year to its January, so totals never round up.
  const month = date.month ?? (isEnd ? 0 : 11);
  return date.year * 12 + month;
}

function experienceIntervals(workExperience, now) {
  const intervals = [];
  let skipped = 0;
  for (const entry of workExperience || []) {
    const start = parseResumeDate(entry.startDate);
    const end   = parseResumeDate(entry.endDate);
    if (!start || start.present || !end) { skipped += 1; continue; }
    const from = toMonthIndex(start, now, false);
    const to   = toMonthIndex(end, now, true);
    if (to < from) { skipped += 1; continue; }
    intervals.push({ from, to, label: `${entry.startDate}–${entry.endDate}` });
  }
  return { intervals, skipped };
}

function suggestYearsOfExperience(workExperience, now) {
  if (!workExperience?.length) {
    return missing('No work experience entries with dates were found in the resume.');
  }
  const { intervals, skipped } = experienceIntervals(workExperience, now);
  if (intervals.length === 0) {
    return missing('The work experience dates in the resume could not be read.');
  }

  // Merge overlapping roles so concurrent jobs are not counted twice.
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  let total = 0;
  let cur = { ...sorted[0] };
  for (const next of sorted.slice(1)) {
    if (next.from <= cur.to) {
      cur.to = Math.max(cur.to, next.to);
    } else {
      total += cur.to - cur.from;
      cur = { ...next };
    }
  }
  total += cur.to - cur.from;

  const years = Math.floor(total / 12);
  if (years > 50) return missing('The work experience dates look inconsistent, so no total was estimated.');

  const ranges = intervals.map(i => i.label).join(', ');
  const note = skipped ? `; ${skipped} role${skipped === 1 ? '' : 's'} without readable dates not counted` : '';
  return {
    value: years,
    evidence: `Estimated from ${intervals.length} date range${intervals.length === 1 ? '' : 's'} in your resume (${ranges})${note}. Overlapping roles are counted once.`,
  };
}

function endRank(entry, now) {
  const end = parseResumeDate(entry.endDate);
  if (!end) return -Infinity;
  return toMonthIndex(end, now, true);
}

// The most recent role is offered as a starting point for "Target role";
// the evidence says exactly where it came from.
function suggestTargetRole(workExperience, now) {
  const candidates = (workExperience || []).filter(e => {
    const role = String(e.role || '').trim();
    return role.length >= 2 && role.length <= 80 && /\p{L}/u.test(role) && !/\b(19|20)\d{2}\b/.test(role);
  });
  if (candidates.length === 0) {
    return missing('No job title could be read from the work experience section.');
  }
  const latest = candidates.reduce((best, e) => (endRank(e, now) > endRank(best, now) ? e : best), candidates[0]);
  const role = latest.role.trim();
  const at = latest.company ? ` at ${latest.company}` : '';
  const dates = latest.startDate ? ` (${latest.startDate}${latest.endDate ? `–${latest.endDate}` : ''})` : '';
  return { value: role, evidence: `Most recent role in your resume${at}${dates}.` };
}

function buildProfileSuggestions(resume, { now = new Date() } = {}) {
  const workExperience = Array.isArray(resume?.workExperience) ? resume.workExperience : [];
  return {
    name:                suggestName(resume?.raw_text),
    target_role:         suggestTargetRole(workExperience, now),
    years_of_experience: suggestYearsOfExperience(workExperience, now),
    target_location:     missing('Locations are not extracted from resumes. Enter this yourself.'),
  };
}

module.exports = { buildProfileSuggestions, parseResumeDate };
