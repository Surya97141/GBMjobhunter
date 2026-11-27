require('dotenv').config();
//ohk so this script is about the various utilities provided to various agents tier wise... and the task was distributed in a 
//way that works the best for each of the LLM models... i.e cover letter is given to OPEN AI and outreach drafting is given to claude..
//this was purely in tution based ... thaet when it comes to text based things.. and convo. centric info gpt rocks!!
if (!process.env.REDIS_URL) throw new Error('REDIS_URL env var is required');

const express     = require('express');
const { z }       = require('zod');
const { callModel } = require('./src/services/modelRouter.service');
const { getCompanySignals, getUserSkills, getUserAiContext } = require('./src/db/lookup.db');
const { aiOptionsSchema, aiStatus, runAi, isProviderEnabled } = require('./src/services/ai/aiClient.service');
const {
  guidanceRequestSchema, SYSTEM_PROMPT: GUIDANCE_SYSTEM_PROMPT, buildUserMessage, sanitiseGuidance,
} = require('./src/services/ai/opportunityGuidance.service');
const { failure } = require('./src/services/ai/errors');
const { parseProfile } = require('./src/services/ai/aiProfile');
const {
  PLAN_SYSTEM_PROMPT, FOLLOWUP_SYSTEM_PROMPT, QUESTION_MAX, planInputSchema,
  sanitisePlan, sanitisePlanObject, sanitiseFollowup, buildPlanMessage, buildFollowupMessage, parseQuestion,
} = require('./src/services/ai/opportunityPlan.service');
const { consumeFollowupAllowance } = require('./src/services/ai/demoQuota.service');

const app    = express();
const router = express.Router();

app.use(express.json());

// Express 4 does not catch rejected promises from async handlers; forward them
// to the error handler at the bottom so the process never sees an unhandled
// rejection and the client gets a generic 500.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Optional free-text fields: the clients send '' (or leave them out) when empty;
// anything that is not a string is rejected rather than crashing on .slice().
const optionalText = z.string().nullish();

// Parses req.body with `schema`. On failure, sends the route's usual 400 body
// (plus the zod issues) and returns null.
function parseBody(schema, req, res, message) {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({ status: 'error', message, errors: result.error.errors });
    return null;
  }
  return result.data;
}

// Validates the `ai` block of a request ({ mode: 'demo' } or { mode: 'byok',
// provider, apiKey }). On failure it sends a FIXED message: no validation
// details, so nothing from the body (such as part of a key) is echoed back.
function parseAiOptions(req, res) {
  const result = aiOptionsSchema.safeParse(req.body?.ai);
  if (!result.success) {
    res.status(400).json({
      status:  'error',
      message: 'ai must be { mode: "demo" } or { mode: "byok", provider: "groq" | "openai" | "anthropic", apiKey }',
    });
    return null;
  }
  // A known provider that this server has not enabled (Anthropic, by default).
  if (result.data.mode === 'byok' && !isProviderEnabled(result.data.provider)) {
    res.status(400).json({ status: 'error', ...failure('provider_disabled') });
    return null;
  }
  return result.data;
}

function requireUserId(req, res) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    res.status(401).json({ status: 'error', message: 'x-user-id header required' });
    return null;
  }
  return userId;
}

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
const coverLetterSchema = z.object({
  role:           z.string().min(1),
  company:        z.string().min(1),
  jobDescription: optionalText,
});

router.post('/generate-cover-letter', asyncHandler(async (req, res) => {
  const body = parseBody(coverLetterSchema, req, res, 'role and company are required');
  if (!body) return;
  const { role, company, jobDescription } = body;

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

  const result = await callModel('tier2', 'cover_letter_generate', {
    systemPrompt,
    messages:    [{ role: 'user', content: userContent }],
    maxTokens:   600,
    temperature: 0.7,
  });

  // Return modelRouter result unchanged — not_configured, success, or any error
  // shape passes straight through so the popup can handle each state cleanly.
  // A thrown error goes to the error handler (generic 500).
  res.json(result);
}));

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

const outreachSchema = z.object({
  companyName: z.string().min(1),
  roleTitle:   z.string().min(1),
  jdText:      optionalText,
  contactName: optionalText,
  contactRole: optionalText,
});

router.post('/generate-outreach', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'x-user-id header required' });
  }

  const body = parseBody(outreachSchema, req, res, 'companyName and roleTitle are required');
  if (!body) return;
  const { companyName, roleTitle, jdText, contactName, contactRole } = body;

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

  const result = await callModel('tier3', 'outreach_draft', {
    userId,
    systemPrompt: OUTREACH_SYSTEM_PROMPT,
    messages:     [{ role: 'user', content: lines.join('\n') }],
    maxTokens:    300,
    temperature:  0.7,
  });

  // success, not_configured, quota_exceeded, and all error shapes pass through unchanged.
  res.json(result);
}));

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

const curriculumSchema = z.object({
  topic: z.enum([...CURRICULUM_TOPICS]),
});

router.post('/explain-hiring-process', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'x-user-id header required' });
  }

  const body = parseBody(curriculumSchema, req, res,
    `topic is required and must be one of: ${[...CURRICULUM_TOPICS].join(', ')}`);
  if (!body) return;
  const { topic } = body;

  // Optional AI mode selection from the web app. Without it, the route keeps its
  // original behaviour (Tier 2 from server env vars).
  let ai = null;
  if (req.body?.ai !== undefined) {
    ai = parseAiOptions(req, res);
    if (!ai) return;
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

  if (ai) {
    const result = await runAi({
      ai, userId, task: 'curriculum_explain',
      system: CURRICULUM_SYSTEM_PROMPT,
      user:   `Topic: ${topic}\n\n${skillsLine}`,
      maxTokens: 900,
    });
    return res.json(result);
  }

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
}));

// ── AI modes for the web app ─────────────────────────────────────────────────
// Which modes are usable on this server. Never includes any key.
router.get('/ai/status', (_req, res) => {
  res.json({ status: 'success', data: aiStatus() });
});

// Explains the deterministic Opportunities recommendations. The provider sees
// only resume skills, target role and the recommendations (see
// opportunityGuidance.service.js for the grounding rules).
router.post('/ai/opportunity-guidance', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const ai = parseAiOptions(req, res);
  if (!ai) return;

  const parsed = guidanceRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'recommendations must be a list of 1 to 10 skills' });
  }
  const { recommendations } = parsed.data;

  let context = { skills: [], targetRole: null };
  try {
    context = await getUserAiContext(userId);
  } catch {
    console.error('[OpportunityGuidance] profile context lookup failed');
  }

  const result = await runAi({
    ai, userId, task: 'opportunity_guidance',
    system: GUIDANCE_SYSTEM_PROMPT,
    user:   buildUserMessage({ ...context, recommendations }),
    maxTokens: 1200,
    json: true,
  });
  if (!result.success) return res.json(result);

  try {
    const guidance = sanitiseGuidance(result.text, recommendations);
    return res.json({
      success: true,
      guidance,
      provider: result.provider, providerLabel: result.providerLabel, model: result.model, mode: result.mode,
    });
  } catch {
    return res.json(failure('bad_output'));
  }
}));

// ── Personalized opportunities (structured guidance) ─────────────────────────
// The client sends the processed profile the user reviewed (aiProfile.js rules,
// re-applied here). Nothing is read from the database for this request, so the
// provider sees exactly what the user previewed. Output is validated and
// grounded by opportunityPlan.service.js; nothing here is a job listing.
router.post('/ai/opportunity-plan', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const ai = parseAiOptions(req, res);
  if (!ai) return;

  const parsedProfile = parseProfile(req.body?.profile);
  if (!parsedProfile.ok) return res.status(400).json({ status: 'error', message: parsedProfile.message });
  const { profile } = parsedProfile;

  const result = await runAi({
    ai, userId, task: 'opportunity_plan',
    system: PLAN_SYSTEM_PROMPT,
    user:   buildPlanMessage(profile),
    maxTokens: 1400,
    json: true,
  });
  if (!result.success) return res.json(result);

  try {
    const plan = sanitisePlan(result.text, profile);
    return res.json({
      success: true, plan, profileUsed: profile,
      provider: result.provider, providerLabel: result.providerLabel, model: result.model, mode: result.mode,
    });
  } catch {
    return res.json(failure('bad_output'));
  }
}));

// One follow-up question, answered only from the processed profile and the
// guidance already shown. Bounded question length, per-user hourly cap.
router.post('/ai/opportunity-followup', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const ai = parseAiOptions(req, res);
  if (!ai) return;

  const question = parseQuestion(req.body?.question);
  if (!question) {
    return res.status(400).json({ status: 'error', message: `question must be 3 to ${QUESTION_MAX} characters` });
  }

  const parsedProfile = parseProfile(req.body?.profile);
  if (!parsedProfile.ok) return res.status(400).json({ status: 'error', message: parsedProfile.message });
  const { profile } = parsedProfile;

  const planShape = planInputSchema.safeParse(req.body?.plan);
  if (!planShape.success) return res.status(400).json({ status: 'error', message: 'plan is missing or malformed' });
  let plan;
  try {
    plan = sanitisePlanObject(planShape.data, profile);
  } catch {
    return res.status(400).json({ status: 'error', message: 'plan does not match the profile' });
  }

  try {
    const blocked = await consumeFollowupAllowance(userId);
    if (blocked) return res.status(429).json(failure(blocked));
  } catch {
    return res.json(failure('quota_unavailable'));
  }

  const result = await runAi({
    ai, userId, task: 'opportunity_followup',
    system: FOLLOWUP_SYSTEM_PROMPT,
    user:   buildFollowupMessage({ profile, plan, question }),
    maxTokens: 500,
    json: true,
  });
  if (!result.success) return res.json(result);

  try {
    const reply = sanitiseFollowup(result.text);
    return res.json({
      success: true, ...reply,
      provider: result.provider, providerLabel: result.providerLabel, model: result.model, mode: result.mode,
    });
  } catch {
    return res.json(failure('bad_output'));
  }
}));

// All routes are mounted under /agent — matching how the gateway proxies them.
// gateway: router.use('/agent', ...) → forwards /agent/* unchanged.
app.use('/agent', router);

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// Error handler: malformed or oversized JSON bodies get a 4xx; anything else is
// logged here and the client gets a generic 500 without internal details.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'Request body must be valid JSON' });
  }
  if (err.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ status: 'error', message: err.message });
  }
  console.error('[Agent] Unhandled route error:', err);
  res.status(500).json({ success: false, error: 'internal_error', message: 'Internal server error' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3005;
  app.listen(PORT, () => console.log(`Agent Service running on port ${PORT}`));
}
