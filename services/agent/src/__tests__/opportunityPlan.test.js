process.env.REDIS_URL = 'redis://mock';

const request = require('supertest');

jest.mock('../services/modelRouter.service', () => ({ callModel: jest.fn() }));
jest.mock('../db/lookup.db', () => ({
  getCompanySignals: jest.fn(),
  getUserSkills:     jest.fn(),
  getUserAiContext:  jest.fn(),
}));
const mockCounters = new Map();
let mockRedisDown = false;
jest.mock('../utils/redis', () => ({
  incr: jest.fn(async (k) => {
    if (mockRedisDown) throw new Error('redis down');
    const n = (mockCounters.get(k) ?? 0) + 1; mockCounters.set(k, n); return n;
  }),
  expire: jest.fn(async () => 1),
}));

const app = require('../../index');
const { getUserAiContext } = require('../db/lookup.db');
const { parseProfile } = require('../services/ai/aiProfile');
const { sanitisePlan } = require('../services/ai/opportunityPlan.service');

const AUTH = { 'x-user-id': 'user-uuid-1' };
const KEY  = 'sk-test-THIS-IS-A-SECRET-KEY-1234567890';
const BYOK = { mode: 'byok', provider: 'openai', apiKey: KEY };

const PROFILE = {
  targetRole: 'Frontend Developer',
  yearsOfExperience: 1,
  skills: ['javascript', 'JavaScript', 'reactjs', 'CSS'],
  experience: [{
    role: 'Web Intern', start: 'Jun 2024', end: 'Aug 2024',
    highlights: 'Built React dashboards. Contact me at jane@example.com or +1 (555) 123-4567, see https://jane.dev',
  }],
  education: [{ degree: 'B.Tech Computer Science', year: 2025 }],
  achievements: ['Won college hackathon, details at linkedin.com/in/jane'],
};

const PLAN = {
  summary: 'You have a solid frontend base. More at https://example.com',
  roleFamilies: [
    { name: 'Frontend engineering internships', why: 'Your React and CSS work fits.', matchingSkills: ['React', 'CSS'] },
    { name: 'Data science roles', why: 'Invented fit.', matchingSkills: ['Python'] },
    { name: 'UI engineer', why: 'Acme is hiring now for this.', matchingSkills: ['CSS'] },
  ],
  skillGaps: [
    { skill: 'typescript', why: 'Common next step for React developers.', evidence: ['React', 'Frontend Developer'] },
    { skill: 'React', why: 'Already has it.', evidence: ['JavaScript'] },
    { skill: 'Rust', why: 'No reason.', evidence: ['Cooking'] },
  ],
  nextSteps: [
    { priority: 3, action: 'Write tests for one project.', relatedSkill: 'Jest' },
    { priority: 1, action: 'Convert a React project to TypeScript.', relatedSkill: 'TypeScript' },
    { priority: 2, action: 'Apply now at www.jobs.example', relatedSkill: null },
  ],
};

let fetchMock;
let logs;
const okChat = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
const sentToProvider = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => {
  jest.clearAllMocks();
  mockCounters.clear();
  mockRedisDown = false;
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_FOLLOWUP_LIMIT_PER_HOUR;
  fetchMock = jest.fn().mockResolvedValue(okChat(JSON.stringify(PLAN)));
  global.fetch = fetchMock;
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => logs.push(args.map(String).join(' ')));
  }
});
afterEach(() => jest.restoreAllMocks());

function expectNoKeyLeak(res) {
  expect(JSON.stringify(res.body)).not.toContain(KEY);
  expect(logs.join('\n')).not.toContain(KEY);
}

const plan = (body) => request(app).post('/agent/ai/opportunity-plan').set(AUTH).send({ ai: BYOK, profile: PROFILE, ...body });

// ─────────────────────────────────────────────────────────────────────────────
describe('profile preprocessing and privacy', () => {
  it('normalises skills, scrubs contact details and links before the provider sees them', async () => {
    const res = await plan();
    expect(res.body.success).toBe(true);

    const userMsg = JSON.parse(sentToProvider().messages[1].content);
    expect(userMsg.skills).toEqual(['JavaScript', 'React', 'CSS']);
    const sent = JSON.stringify(userMsg);
    for (const secret of ['jane@example.com', '555', 'https://jane.dev', 'linkedin.com']) {
      expect(sent).not.toContain(secret);
    }
    expect(userMsg.experience[0].highlights).toContain('Built React dashboards');
    // The response reports exactly what was used.
    expect(res.body.profileUsed).toEqual(userMsg);
  });

  it('drops over-long skills instead of truncating them', () => {
    const { profile } = parseProfile({ skills: ['Advanced distributed systems design and architecture patterns', 'SQL'] });
    expect(profile.skills).toEqual(['SQL']);
  });

  it('keeps date ranges that only look like numbers', () => {
    const { profile } = parseProfile({ skills: ['SQL'], experience: [{ role: 'Analyst', start: '2019 - 2021' }] });
    expect(profile.experience[0].start).toBe('2019 - 2021');
  });

  it.each([
    ['email',   { email: 'jane@example.com' }],
    ['name',    { name: 'Jane' }],
    ['rawText', { rawText: 'full resume' }],
    ['company inside experience', { experience: [{ role: 'Intern', company: 'Acme' }] }],
  ])('rejects a profile carrying %s and calls no provider', async (_label, extra) => {
    const res = await plan({ profile: { ...PROFILE, ...extra } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent missing fields', async () => {
    const res = await plan({ profile: { skills: ['Python'] } });
    expect(res.body.success).toBe(true);
    const userMsg = JSON.parse(sentToProvider().messages[1].content);
    expect(userMsg).toEqual({
      targetRole: null, yearsOfExperience: null, skills: ['Python'], experience: [], education: [], achievements: [],
    });
  });

  it('refuses an empty profile', async () => {
    const res = await plan({ profile: { skills: [] } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reads the stored resume for this request', async () => {
    await plan();
    expect(getUserAiContext).not.toHaveBeenCalled();
  });
});

describe('plan output validation', () => {
  it('keeps only grounded items, strips links and drops vacancy claims', async () => {
    const res = await plan();
    const { plan: p } = res.body;

    expect(p.summary).not.toMatch(/https?:/);
    expect(p.roleFamilies).toEqual([
      { name: 'Frontend engineering internships', why: 'Your React and CSS work fits.', matchingSkills: ['React', 'CSS'] },
    ]);
    expect(p.skillGaps).toEqual([
      { skill: 'TypeScript', why: 'Common next step for React developers.', evidence: ['React', 'Frontend Developer'] },
    ]);
    // Re-ordered by priority, renumbered; unknown related skill cleared; "apply now" dropped.
    expect(p.nextSteps).toEqual([
      { priority: 1, action: 'Convert a React project to TypeScript.', relatedSkill: 'TypeScript' },
      { priority: 2, action: 'Write tests for one project.', relatedSkill: null },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/url|href|https?:/i);
  });

  it('returns bad_output when the reply is not JSON', async () => {
    fetchMock.mockResolvedValue(okChat('Here are some thoughts, no JSON.'));
    const res = await plan();
    expect(res.body).toEqual({ success: false, error: 'bad_output', message: expect.any(String) });
  });

  it('returns bad_output when nothing grounded survives', () => {
    const { profile } = parseProfile(PROFILE);
    expect(() => sanitisePlan(JSON.stringify({
      roleFamilies: [{ name: 'X', why: 'Y', matchingSkills: ['Cobol'] }],
    }), profile)).toThrow('could not be used');
  });
});

describe('provider failure', () => {
  it.each([
    [401, 'invalid_key'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
  ])('maps provider HTTP %s to %s without leaking the key', async (status, code) => {
    fetchMock.mockResolvedValue({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) });
    const res = await plan();
    expect(res.body).toEqual({ success: false, error: code, message: expect.any(String) });
    expectNoKeyLeak(res);
  });

  it('reports a timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    const res = await plan();
    expect(res.body.error).toBe('timeout');
  });

  it('demo mode without a server key calls no provider', async () => {
    const res = await plan({ ai: { mode: 'demo' } });
    expect(res.body.error).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs profile contents or the key', async () => {
    await plan();
    const all = logs.join('\n');
    expect(all).not.toContain('Built React dashboards');
    expect(all).not.toContain(KEY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('follow-up questions', () => {
  const VALID_PLAN = {
    summary: 'Solid base.',
    roleFamilies: [{ name: 'Frontend internships', why: 'Fits.', matchingSkills: ['React'] }],
    skillGaps: [{ skill: 'TypeScript', why: 'Next step.', evidence: ['React'] }],
    nextSteps: [{ priority: 1, action: 'Learn TypeScript.', relatedSkill: 'TypeScript' }],
  };
  const followup = (body) => request(app).post('/agent/ai/opportunity-followup').set(AUTH)
    .send({ ai: BYOK, profile: PROFILE, plan: VALID_PLAN, question: 'Which gap should I start with?', ...body });

  beforeEach(() => {
    fetchMock.mockResolvedValue(okChat(JSON.stringify({ answer: 'Start with TypeScript. See https://x.example', outOfScope: false })));
  });

  it('answers from the profile and plan only, with links stripped', async () => {
    const res = await followup();
    expect(res.body).toMatchObject({ success: true, answer: 'Start with TypeScript. See', outOfScope: false });
    const userMsg = JSON.parse(sentToProvider().messages[1].content);
    expect(Object.keys(userMsg).sort()).toEqual(['guidance', 'profile', 'question']);
    expect(JSON.stringify(userMsg)).not.toContain('jane@example.com');
  });

  it.each([
    ['too short', 'hi'],
    ['too long', 'x'.repeat(301)],
    ['not text', 42],
    ['only whitespace', '      '],
  ])('rejects a question that is %s without calling the provider', async (_label, question) => {
    const res = await followup({ question });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a question of exactly 300 characters', async () => {
    const res = await followup({ question: 'q'.repeat(300) });
    expect(res.body.success).toBe(true);
  });

  it('re-validates a plan sent back by the client', async () => {
    const tampered = {
      ...VALID_PLAN,
      roleFamilies: [...VALID_PLAN.roleFamilies, { name: 'Senior architect', why: 'Made up.', matchingSkills: ['Cobol'] }],
    };
    await followup({ plan: tampered });
    const guidance = JSON.parse(sentToProvider().messages[1].content).guidance;
    expect(guidance.roleFamilies.map(r => r.name)).toEqual(['Frontend internships']);
  });

  it('rejects a malformed plan', async () => {
    const res = await followup({ plan: { roleFamilies: 'nope' } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps follow-ups per user per hour', async () => {
    process.env.AI_FOLLOWUP_LIMIT_PER_HOUR = '2';
    expect((await followup()).body.success).toBe(true);
    expect((await followup()).body.success).toBe(true);
    const res = await followup();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('followup_limit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the limit store is down', async () => {
    mockRedisDown = true;
    const res = await followup();
    expect(res.body.error).toBe('quota_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns bad_output for a reply without an answer', async () => {
    fetchMock.mockResolvedValue(okChat(JSON.stringify({ text: 'wrong field' })));
    const res = await followup();
    expect(res.body.error).toBe('bad_output');
  });

  it('passes the out-of-scope flag through', async () => {
    fetchMock.mockResolvedValue(okChat(JSON.stringify({ answer: 'I cannot see live openings.', outOfScope: true })));
    const res = await followup({ question: 'Which companies are hiring interns?' });
    expect(res.body).toMatchObject({ success: true, outOfScope: true });
  });
});
