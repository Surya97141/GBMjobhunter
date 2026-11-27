// AI explanation of the deterministic skill recommendations on the
// Opportunities page. Grounding rules:
//   - The model sees ONLY: the user's resume skills and target role (read from
//     the database) and the recommendations the deterministic engine produced,
//     with the user's skills each one builds on.
//   - It may not introduce job listings, employers, courses, communities,
//     links, statistics or skills outside the provided list.
//   - Its output is validated: items for unknown skills are dropped, URLs are
//     removed, lengths are capped. If nothing valid remains, it is an error.

const { z } = require('zod');
const { AiError } = require('./errors');

const MAX_ITEMS = 5;

const recommendationSchema = z.object({
  skill:    z.string().trim().min(1).max(60),
  level:    z.enum(['foundational', 'intermediate', 'advanced']).optional(),
  domain:   z.string().trim().max(30).optional(),
  buildsOn: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});

const guidanceRequestSchema = z.object({
  recommendations: z.array(recommendationSchema).min(1).max(10),
});

const SYSTEM_PROMPT =
  'You explain skill recommendations to a job seeker. Use ONLY the data in the user message: ' +
  'their resume skills, their target role (may be missing), and a list of recommended skills, ' +
  'each with the existing skills it builds on.\n\n' +
  'Rules:\n' +
  '- Never mention or invent job listings, employers, salaries, courses, books, websites, ' +
  'communities, certifications, people, statistics, market demand or links.\n' +
  '- Only discuss skills from the recommended list, spelled exactly as given.\n' +
  `- Choose at most ${MAX_ITEMS} recommendations, preferring those most relevant to the target role. ` +
  'If no target role is given, do not guess one.\n' +
  '- For each: one or two plain sentences on why it is a sensible next step given the specific ' +
  'skills it builds on, then one small practice project idea using those skills.\n' +
  '- If the data is too thin to say anything specific, say so in the summary instead of filling space.\n\n' +
  'Respond with JSON only, no markdown: ' +
  '{"summary": "<at most two sentences>", "items": [{"skill": "<exact skill>", "explanation": "<text>"}]}';

function buildUserMessage({ skills, targetRole, recommendations }) {
  return JSON.stringify({
    resumeSkills: skills,
    targetRole:   targetRole || null,
    recommendations: recommendations.map(r => ({
      skill:    r.skill,
      level:    r.level ?? null,
      domain:   r.domain ?? null,
      buildsOn: r.buildsOn,
    })),
  });
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

function clean(text, max) {
  return String(text ?? '').replace(URL_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Pulls the first JSON object out of the reply (models sometimes add fences).
function extractJson(text) {
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitiseGuidance(rawText, recommendations) {
  const parsed = extractJson(rawText);
  if (!parsed || typeof parsed !== 'object') throw new AiError('bad_output');

  const allowed = new Map(recommendations.map(r => [r.skill.toLowerCase(), r.skill]));
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    const key = String(item?.skill ?? '').trim().toLowerCase();
    if (!allowed.has(key) || seen.has(key)) continue; // not a provided recommendation
    const explanation = clean(item.explanation, 500);
    if (!explanation) continue;
    seen.add(key);
    items.push({ skill: allowed.get(key), explanation });
    if (items.length === MAX_ITEMS) break;
  }

  const summary = clean(parsed.summary, 400);
  if (items.length === 0 && !summary) throw new AiError('bad_output');
  return { summary, items };
}

module.exports = {
  guidanceRequestSchema,
  SYSTEM_PROMPT,
  buildUserMessage,
  sanitiseGuidance,
  MAX_ITEMS,
};
