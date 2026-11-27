// Explicit provider registry for user-facing AI features.
//
// Only these providers exist, each with a fixed official endpoint. Requests
// choose a provider by id; they cannot supply a base URL or a model. Models can
// be changed by the operator through env vars.
//
// Anthropic is DISABLED unless AI_ENABLE_ANTHROPIC=true: its adapter has only
// been checked offline (the request the SDK builds), not against the live API
// with a real key. While disabled it is not listed by /agent/ai/status and
// requests that select it are rejected.

const { callOpenAiCompatible } = require('./openaiCompatible.adapter');
const { callAnthropic }        = require('./anthropic.adapter');

const PROVIDERS = {
  groq: {
    id:      'groq',
    label:   'Groq',
    enabled: () => true,
    model:   () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    call:    (args) => callOpenAiCompatible({ ...args, baseUrl: 'https://api.groq.com/openai/v1' }),
  },
  openai: {
    id:      'openai',
    label:   'OpenAI',
    enabled: () => true,
    model:   () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
    call:    (args) => callOpenAiCompatible({ ...args, baseUrl: 'https://api.openai.com/v1' }),
  },
  anthropic: {
    id:      'anthropic',
    label:   'Anthropic (Claude)',
    enabled: () => process.env.AI_ENABLE_ANTHROPIC === 'true',
    model:   () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    call:    (args) => callAnthropic(args),
  },
};

// Every known id (used to validate the request shape).
const PROVIDER_IDS = Object.keys(PROVIDERS);

function isProviderEnabled(id) {
  return Boolean(PROVIDERS[id]?.enabled());
}

function publicProviderList() {
  return PROVIDER_IDS
    .filter(isProviderEnabled)
    .map(id => ({ id, label: PROVIDERS[id].label, model: PROVIDERS[id].model() }));
}

module.exports = { PROVIDERS, PROVIDER_IDS, isProviderEnabled, publicProviderList };
