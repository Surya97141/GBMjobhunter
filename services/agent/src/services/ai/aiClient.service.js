// Entry point for user-facing AI features (web app). Two modes:
//
//   demo — the server's shared Groq key from GROQ_API_KEY, with daily quotas.
//          If the variable is missing, every request returns not_configured.
//   byok — "bring your own key": the user's key for an enabled provider (groq,
//          openai; anthropic only with AI_ENABLE_ANTHROPIC=true), sent in the
//          request body for this request only.
//
// Key handling (byok): the key arrives in the authenticated request, is passed
// to the provider adapter, and is dropped when the request ends. It is never
// stored, never logged, and never included in a response or error message.
// Logs carry only mode, provider, task, outcome and HTTP status.

const { z } = require('zod');
const { PROVIDERS, PROVIDER_IDS, isProviderEnabled, publicProviderList } = require('./providers');
const { AiError, failure } = require('./errors');
const { consumeDemoQuota, perUserLimit, totalLimit } = require('./demoQuota.service');

const timeoutMs = () => Number(process.env.AI_TIMEOUT_MS) || 25_000;

// `.strict()` rejects any extra field — in particular a base URL or model
// override, which this change deliberately does not accept.
const aiOptionsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('demo') }).strict(),
  z.object({
    mode:     z.literal('byok'),
    provider: z.enum(PROVIDER_IDS),
    // Printable ASCII, no spaces: every supported provider's key format.
    apiKey:   z.string().min(20).max(400).regex(/^[\x21-\x7E]+$/),
  }).strict(),
]);

function demoAvailable() {
  return Boolean(process.env.GROQ_API_KEY);
}

function aiStatus() {
  return {
    demo: {
      available: demoAvailable(),
      provider:  'groq',
      label:     PROVIDERS.groq.label,
      model:     PROVIDERS.groq.model(),
      limits:    { perUserPerDay: perUserLimit(), allUsersPerDay: totalLimit() },
    },
    byok: { providers: publicProviderList() },
  };
}

function log(level, fields) {
  const line = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console[level](`[AI] ${line}`);
}

// Runs one completion. Never throws: returns { success: true, text, provider,
// providerLabel, model, mode } or { success: false, error, message }.
async function runAi({ ai, userId, task, system, user, maxTokens = 1200, json = false }) {
  let providerId;
  let apiKey;

  if (ai.mode === 'demo') {
    if (!demoAvailable()) {
      log('warn', { mode: 'demo', task, outcome: 'not_configured' });
      return failure('not_configured');
    }
    try {
      const blocked = await consumeDemoQuota(userId);
      if (blocked) {
        log('warn', { mode: 'demo', task, outcome: blocked });
        return failure(blocked);
      }
    } catch {
      log('error', { mode: 'demo', task, outcome: 'quota_unavailable' });
      return failure('quota_unavailable');
    }
    providerId = 'groq';
    apiKey     = process.env.GROQ_API_KEY;
  } else {
    // Also checked when the request is parsed; repeated here so no caller can
    // reach a disabled provider.
    if (!isProviderEnabled(ai.provider)) {
      log('warn', { mode: 'byok', provider: ai.provider, task, outcome: 'provider_disabled' });
      return failure('provider_disabled');
    }
    providerId = ai.provider;
    apiKey     = ai.apiKey;
  }

  const provider = PROVIDERS[providerId];
  const model    = provider.model();

  try {
    const text = await provider.call({ apiKey, model, system, user, maxTokens, json, timeoutMs: timeoutMs() });
    log('log', { mode: ai.mode, provider: providerId, task, outcome: 'success' });
    return { success: true, text, mode: ai.mode, provider: providerId, providerLabel: provider.label, model };
  } catch (err) {
    const aiErr = err instanceof AiError ? err : new AiError('provider_error');
    log('warn', { mode: ai.mode, provider: providerId, task, outcome: aiErr.code, status: aiErr.status });
    return failure(aiErr);
  }
}

module.exports = { aiOptionsSchema, aiStatus, runAi, demoAvailable, isProviderEnabled };
