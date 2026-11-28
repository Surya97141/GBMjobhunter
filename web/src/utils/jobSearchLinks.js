// Personalized job-board SEARCH links for the Insights globe.
//
// What this is: links that open a search on an established job board (LinkedIn
// Jobs, Indeed) for a role term in one of the globe's regions. The role terms
// come from the user's reviewed profile and the validated AI opportunity plan.
//
// What this is NOT: job listings. This app has no live job-listings API, so it
// cannot know whether a search returns anything, or compare regions by how
// many openings they have. The board decides what a search shows.
//
// Safety rules enforced here:
//   - the model never supplies a URL: it only supplies role names, which are
//     cleaned into plain search words. Every URL is built from a fixed host in
//     ALLOWED_SEARCH_HOSTS and a fixed path, with URLSearchParams encoding.
//   - every link is re-checked by isSafeSearchUrl before it is rendered, and
//     opened with EXTERNAL_LINK_PROPS (new tab, no opener, no referrer).
//   - the profile sent for this feature is smaller than the Opportunities one:
//     target role, years of experience, skills and experience role titles with
//     dates. No highlights, education, achievements, contact details, company
//     or school names, or raw resume text.
//
// Pure functions only, so they run under node --test.

import { finalizeAiProfile, scrubText } from './aiProfile.js';
import { GLOBE_REGIONS } from './globeRegions.js';

// ── Profile sent to the AI provider ─────────────────────────────────────────

// Takes a profile built by buildAiProfile (and possibly edited in the review
// step) and keeps only what search terms need. The result is exactly what is
// sent; the agent service re-applies the same rules on its side.
export function buildGlobeProfile(profile) {
  const base = finalizeAiProfile({
    targetRole:        profile?.targetRole,
    yearsOfExperience: profile?.yearsOfExperience,
    skills:            profile?.skills,
    experience: (Array.isArray(profile?.experience) ? profile.experience : [])
      .map(e => ({ role: e?.role, start: e?.start, end: e?.end, highlights: '' })),
    education:    [],
    achievements: [],
  });
  // Entries left with no role title carry nothing useful once highlights go.
  return { ...base, experience: base.experience.filter(e => e.role) };
}

// Field-by-field description for the "exactly what will be sent" preview.
export function describeGlobeProfile(profile) {
  const exp = profile.experience;
  return [
    { label: 'Target role',         value: profile.targetRole ?? 'Not set (left empty)' },
    { label: 'Years of experience', value: profile.yearsOfExperience ?? 'Not set (left empty)' },
    { label: 'Skills',              value: profile.skills.length ? profile.skills.join(', ') : 'None' },
    { label: 'Past role titles',    value: exp.length ? exp.map(e => [e.role, [e.start, e.end].filter(Boolean).join(' to ')].filter(Boolean).join(', ')).join('; ') : 'None' },
  ];
}

// ── Search terms ────────────────────────────────────────────────────────────

export const MAX_SEARCH_TERMS = 3;
export const SEARCH_TERM_MAX  = 60;

// Generic trailing words that make a board search worse, not better.
const TRAILING_FILLER = /(?:\s+(?:roles?|positions?|jobs?|opportunities|openings|careers?|tracks?|paths?))+$/i;

// Turns a role name into plain search words: no links, contact details,
// markup or control characters; letters, digits, spaces and . + # & / ' - only.
export function sanitizeSearchTerm(value) {
  const scrubbed = scrubText(typeof value === 'string' ? value : '', 400)
    .replace(/<[^>]*>/g, ' ')                     // drop anything tag-like
    .replace(/[^\p{L}\p{N}\s.+#&/'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_FILLER, '')
    .replace(/^[\s.&/'-]+|[\s.&/'-]+$/g, '');
  if (scrubbed.length <= SEARCH_TERM_MAX) return scrubbed;
  const cut = scrubbed.slice(0, SEARCH_TERM_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > SEARCH_TERM_MAX * 0.5 ? cut.slice(0, space) : cut).trim();
}

// Search terms grounded in the reviewed profile: the user's own target role
// first, then each AI role family whose matching skills all appear in the
// profile skills (the server already enforces this; it is re-checked here).
export function deriveSearchTerms({ profile, plan }) {
  const skills = new Set((profile?.skills ?? []).map(s => String(s).toLowerCase()));
  const candidates = [];
  if (profile?.targetRole) candidates.push(profile.targetRole);
  for (const family of Array.isArray(plan?.roleFamilies) ? plan.roleFamilies : []) {
    const matching = Array.isArray(family?.matchingSkills) ? family.matchingSkills : [];
    const grounded = matching.length > 0 && matching.every(s => skills.has(String(s).toLowerCase()));
    if (grounded) candidates.push(family.name);
  }

  const terms = [];
  const seen = new Set();
  for (const raw of candidates) {
    const term = sanitizeSearchTerm(raw);
    const key = term.toLowerCase();
    if (term.length < 2 || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_SEARCH_TERMS) break;
  }
  return terms;
}

// ── URLs ────────────────────────────────────────────────────────────────────

export const JOB_BOARDS = Object.freeze([
  { id: 'linkedin', label: 'LinkedIn Jobs' },
  { id: 'indeed',   label: 'Indeed' },
]);

export const ALLOWED_SEARCH_HOSTS = Object.freeze(new Set([
  'www.linkedin.com',
  'www.indeed.com', 'ca.indeed.com', 'uk.indeed.com', 'nl.indeed.com', 'fr.indeed.com',
  'de.indeed.com', 'ae.indeed.com', 'in.indeed.com', 'sg.indeed.com', 'jp.indeed.com', 'au.indeed.com',
]));

function withParams(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// The search URL for one board, term and region, or null if any part is not
// one this module knows. Only fixed hosts and paths; values are encoded by
// URLSearchParams, so a term cannot add parameters or change the path.
export function buildSearchUrl(boardId, term, region) {
  const keywords = sanitizeSearchTerm(term);
  if (!keywords || !region) return null;
  let url = null;
  if (boardId === 'linkedin') {
    url = withParams('https://www.linkedin.com/jobs/search/', { keywords, location: region.searchLocation });
  } else if (boardId === 'indeed') {
    if (!ALLOWED_SEARCH_HOSTS.has(region.indeedHost)) return null;
    url = withParams(`https://${region.indeedHost}/jobs`, { q: keywords, l: region.indeedLocation });
  }
  return url && isSafeSearchUrl(url) ? url : null;
}

// True only for an https URL on an allowed job-board host, with no
// credentials or custom port. Anything else is not rendered as a link.
export function isSafeSearchUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && ALLOWED_SEARCH_HOSTS.has(url.hostname)
    && url.username === '' && url.password === ''
    && url.port === '';
}

// Props for every outbound search link.
export const EXTERNAL_LINK_PROPS = Object.freeze({ target: '_blank', rel: 'noopener noreferrer' });

// [{ term, links: [{ board, label, url }] }] for one region. A link that fails
// the safety check is left out rather than shown.
export function buildRegionSearchLinks(region, terms) {
  if (!region) return [];
  return (Array.isArray(terms) ? terms : [])
    .map(term => ({
      term,
      links: JOB_BOARDS
        .map(board => ({ board: board.id, label: board.label, url: buildSearchUrl(board.id, term, region) }))
        .filter(link => link.url),
    }))
    .filter(group => group.links.length > 0);
}

// Regions that can show search links (all of them, as long as there are terms).
export function searchableRegions(terms) {
  return terms?.length ? GLOBE_REGIONS : [];
}

// ── Request state ───────────────────────────────────────────────────────────

// idle → reviewing → sending → done | error. A failed or cancelled request
// keeps any search terms from an earlier success, so the map is not emptied.
export const INITIAL_PERSONALIZE_STATE = Object.freeze({ phase: 'idle', terms: [], providerLabel: null, message: '' });

export function personalizeReducer(state, action) {
  switch (action.type) {
    case 'review':  return { ...state, phase: 'reviewing', message: '' };
    case 'cancel':  return { ...state, phase: state.terms.length ? 'done' : 'idle', message: '' };
    case 'send':    return state.phase === 'sending' ? state : { ...state, phase: 'sending', message: '' };
    case 'success': return { phase: 'done', terms: action.terms, providerLabel: action.providerLabel ?? null, message: '' };
    case 'failure': return { ...state, phase: 'error', message: action.message || 'Personalization failed. Try again.' };
    case 'clear':   return INITIAL_PERSONALIZE_STATE;
    default:        return state;
  }
}

// Reads the /agent/ai/opportunity-plan response (already validated by
// readPlanResponse) into search terms, or a message when none can be used.
export function termsFromPlan(plan, profile) {
  if (!plan) return { ok: false, message: 'The AI response could not be used. Try again.' };
  const terms = deriveSearchTerms({ profile, plan });
  if (terms.length === 0) {
    return { ok: false, message: 'The AI response had no role suggestions that match your skills. Add a target role or more skills and try again.' };
  }
  return { ok: true, terms };
}
