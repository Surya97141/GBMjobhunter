// Adapter for providers that speak the OpenAI Chat Completions format
// (Groq and OpenAI). Base URLs are fixed per provider in providers.js; callers
// can never supply their own.
//
// Security: the API key is only placed in the Authorization header of the
// outgoing request. Provider response bodies are NEVER logged or returned,
// because some providers echo part of the key in authentication errors.
// Failures are reported as a fixed category plus the HTTP status only.

const { AiError } = require('./errors');

async function callOpenAiCompatible({ baseUrl, apiKey, model, system, user, maxTokens, json, timeoutMs }) {
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        // max_completion_tokens is accepted by both Groq and OpenAI and, unlike
        // max_tokens, also by OpenAI's reasoning models. No temperature is sent
        // for the same reason (some models only accept the default).
        max_completion_tokens: maxTokens,
        ...(json && { response_format: { type: 'json_object' } }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new AiError(isTimeout ? 'timeout' : 'provider_unavailable');
  }

  if (!res.ok) {
    // Drain the body without reading it into logs or errors.
    try { await res.arrayBuffer(); } catch { /* ignore */ }
    if (res.status === 401) throw new AiError('invalid_key', res.status);
    if (res.status === 403) throw new AiError('permission_denied', res.status);
    if (res.status === 429) throw new AiError('rate_limited', res.status);
    if (res.status >= 500)  throw new AiError('provider_unavailable', res.status);
    throw new AiError('provider_error', res.status);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new AiError('bad_output');
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AiError('bad_output');
  return text.trim();
}

module.exports = { callOpenAiCompatible };
