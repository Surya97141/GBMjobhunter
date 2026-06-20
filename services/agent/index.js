require('dotenv').config();

if (!process.env.REDIS_URL) throw new Error('REDIS_URL env var is required');

const express     = require('express');
const { callModel } = require('./src/services/modelRouter.service');
const { getCompanySignals, getUserSkills } = require('./src/db/lookup.db');

const app    = express();
const router = express.Router();

app.use(express.json());

// ── Health — tier configuration check ────────────────────────────────────────
router.get('/health', (_req, res) => {
  const TIER2_REQUIRED = ['TIER2_API_BASE', 'TIER2_API_KEY', 'TIER2_MODEL_NAME'];
  const tier2Missing   = TIER2_REQUIRED.filter(v => !process.env[v]);
  const tier2Ok        = tier2Missing.length === 0;
  const tier3Ok        = !!process.env.TIER3_API_KEY;

  res.json({
    status: 'ok',
    tiers: {
      tier1: {
        status: 'always_available',
        note:   'runs client-side or via direct DB query — not routed through this service',
      },
      tier2: {
        status:  tier2Ok ? 'configured' : 'not_configured',
        model:   process.env.TIER2_MODEL_NAME || null,
        ...(tier2Missing.length && { missing: tier2Missing }),
      },
      tier3: {
        status:  tier3Ok ? 'configured' : 'not_configured',
        model:   process.env.TIER3_MODEL || 'claude-sonnet-4-6',
        ...(!tier3Ok && { missing: ['TIER3_API_KEY'] }),
      },
    },
    quota: {
      tier3_per_day: Number(process.env.TIER3_QUOTA_PER_DAY) || 5,
    },
  });
});

// ── Cover letter generation — Tier 2 ─────────────────────────────────────────
// Calls Tier 2 (OpenAI-compatible) with a real prompt instructing a 3-paragraph,
// non-generic letter. modelRouter result passes straight through — callers receive
// { success: false, error: 'not_configured', ... } when Tier 2 env vars are absent.
router.post('/generate-cover-letter', async (req, res) => {
  const { role, company, jobDescription } = req.body ?? {};

  if (!role || !company) {
    return res.status(400).json({ status: 'error', message: 'role and company are required' });
  }

  const systemPrompt =
    'You are a professional cover letter writer. Write a focused 3-paragraph cover letter ' +
    'tailored exactly to the role and company supplied by the user.\n\n' +
    'Paragraph 1: Opening that names the role and company with genuine specific interest — ' +
    'no clichés like "I am excited to apply" or "I am writing to apply".\n' +
    'Paragraph 2: Two or three concrete achievements or skills that directly match the ' +
    'requirements of this specific role.\n' +
    'Paragraph 3: A brief, confident closing with a clear call to action.\n\n' +
    'Hard rules: never include placeholder brackets such as [Company], [Name], or ' +
    '{{role}} in the output — use the actual supplied values. No "Please find attached". ' +
    'Plain text only — no markdown, no bullet points. Maximum 250 words.';

  const userContent =
    `Write a cover letter for this role:\nRole: ${role}\nCompany: ${company}` +
    (jobDescription ? `\n\nJob description:\n${jobDescription.slice(0, 3000)}` : '');

  try {
    const result = await callModel('tier2', 'cover_letter_generate', {
      systemPrompt,
      messages:    [{ role: 'user', content: userContent }],
      maxTokens:   600,
      temperature: 0.7,
    });

    // Return modelRouter result unchanged — not_configured, success, or any error
    // shape passes straight through so the popup can handle each state cleanly.
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'internal_error', message: err.message });
  }
});

// ── Outreach message drafting — Tier 3 ───────────────────────────────────────
// Calls Tier 3 (Claude) with company signals for tone calibration and the user's
// actual skills for personalisation. Plain prose output — no JSON parsing needed
// (same pattern as cover letter, confirmed fragility-free). Quota enforcement
// happens once inside callTier3 — not duplicated here.
const OUTREACH_SYSTEM_PROMPT =
  'You are drafting a short, professional outreach message from a job applicant to a contact ' +
  'at a company they\'re interested in. Use only the facts provided — company name, role, job ' +
  'description, the applicant\'s actual skills, and optional cohort signal data about typical ' +
  'response patterns at this company. Never invent details about the company, its culture, or ' +
  'its people that were not provided. If cohort data shows a high ghost rate or slow average ' +
  'response time for this company, let that inform a more direct, lower-pressure tone rather ' +
  'than an assumptive one — do not mention the ghost rate or any internal statistic directly ' +
  'in the message itself, it is for tone calibration only, not content. Keep the message under ' +
  '150 words. No subject line, no email formatting — just the message body. Professional but ' +
  'human, not corporate boilerplate. End with a clear, low-effort ask (e.g. a quick chat, not ' +
  'demanding a referral outright).';

router.post('/generate-outreach', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'x-user-id header required' });
  }

  const { companyName, roleTitle, jdText, contactName, contactRole } = req.body ?? {};
  if (!companyName || !roleTitle) {
    return res.status(400).json({ status: 'error', message: 'companyName and roleTitle are required' });
  }

  // Non-fatal lookups — signals and skills are supplementary context, not blockers.
  let signals = null;
  try {
    signals = await getCompanySignals(companyName);
  } catch (err) {
    console.error('[OutreachAgent] Company signals lookup failed:', err.message);
  }

  let skills = [];
  try {
    skills = await getUserSkills(userId);
  } catch (err) {
    console.error('[OutreachAgent] User skills lookup failed:', err.message);
  }

  // Cohort context — passed to model for tone calibration only, never in message text.
  const cohortParts = [];
  if (signals?.ghost_rate        != null) cohortParts.push(`ghost rate ${Math.round(signals.ghost_rate * 100)}%`);
  if (signals?.avg_response_days != null) cohortParts.push(`average response time ${signals.avg_response_days} days`);
  if (signals?.size_band         != null) cohortParts.push(`company size band: ${signals.size_band}`);
  const cohortContext = cohortParts.length ? cohortParts.join(', ') : null;

  const lines = [
    `Company: ${companyName}`,
    `Role: ${roleTitle}`,
    contactName   ? `Contact name: ${contactName}`                   : null,
    contactRole   ? `Contact's role: ${contactRole}`                 : null,
    jdText        ? `\nJob description:\n${jdText.slice(0, 1500)}`   : null,
    skills.length ? `\nApplicant's skills: ${skills.join(', ')}`     : null,
    cohortContext  ? `\nCohort signal (tone calibration only — do not reference in message): ${cohortContext}` : null,
  ].filter(l => l !== null);

  try {
    const result = await callModel('tier3', 'outreach_draft', {
      userId,
      systemPrompt: OUTREACH_SYSTEM_PROMPT,
      messages:     [{ role: 'user', content: lines.join('\n') }],
      maxTokens:    300,
      temperature:  0.7,
    });

    // success, not_configured, quota_exceeded, and all error shapes pass through unchanged.
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'internal_error', message: err.message });
  }
});

// ── Hidden Curriculum Decoder — Tier 2 ───────────────────────────────────────
// Explains unwritten hiring-process rules using the four-barrier Schema Fit
// method, personalised with the user's actual skills as the Barrier 2 example.
// Plain prose output — no JSON parsing needed (confirmed same as cover letter path).
const CURRICULUM_TOPICS = new Set([
  'behavioral round',
  'recruiter first-30-seconds screen',
  'talking about a project',
  'what culture fit means',
  'following up after an interview',
]);

const CURRICULUM_SYSTEM_PROMPT =
  'You are a learning assistant that defeats four specific cognitive barriers when ' +
  'explaining unfamiliar concepts to someone with no prior exposure to corporate hiring.\n\n' +
  'Barrier 1 — Overload: translate ALL jargon into plain language. Never use a technical ' +
  'or corporate term without immediately explaining it in everyday words.\n\n' +
  'Barrier 2 — Abstractness: never explain a concept using only abstract description. ' +
  'Always ground it in one concrete, relatable example or analogy using the applicant\'s ' +
  'actual skills provided — not a generic placeholder.\n\n' +
  'Barrier 3 — Element interactivity: never explain a whole complex process at once. ' +
  'Chunk it — explain one piece, confirm it lands, then add the next piece on top.\n\n' +
  'Barrier 4 — Interference: end with one short check that tests whether the explanation ' +
  'actually transferred, framed as "if this is true, then X should also be true — does ' +
  'that make sense?" rather than just asking "did you understand?"';

router.post('/explain-hiring-process', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'x-user-id header required' });
  }

  const { topic } = req.body ?? {};
  if (!topic || !CURRICULUM_TOPICS.has(topic)) {
    return res.status(400).json({
      status:  'error',
      message: `topic is required and must be one of: ${[...CURRICULUM_TOPICS].join(', ')}`,
    });
  }

  let skills = [];
  try {
    skills = await getUserSkills(userId);
  } catch (err) {
    console.error('[CurriculumDecoder] Skills lookup failed:', err.message);
  }

  const skillsLine = skills.length
    ? `The applicant's skills: ${skills.join(', ')}. Use one of these skills as the ` +
      `concrete example required by Barrier 2 — not a generic placeholder.`
    : 'The applicant has not uploaded a resume yet. Use a generic but relatable skill ' +
      'example (e.g. "writing code" or "building a spreadsheet") for Barrier 2.';

  try {
    const result = await callModel('tier2', 'curriculum_explain', {
      systemPrompt: CURRICULUM_SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `Topic: ${topic}\n\n${skillsLine}`,
      }],
      maxTokens:   700,
      temperature: 0.6,
    });

    // Plain prose output — no JSON parsing (same pattern as cover letter and outreach routes).
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'internal_error', message: err.message });
  }
});

// All routes are mounted under /agent — matching how the gateway proxies them.
// gateway: router.use('/agent', ...) → forwards /agent/* unchanged.
app.use('/agent', router);

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Agent Service running on port ${PORT}`));
