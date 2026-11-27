// Adapter for Anthropic (Claude), using the official SDK already used by the
// agent service (@anthropic-ai/sdk, installed 0.27.x). The SDK talks to the
// fixed Anthropic API endpoint; no base URL is ever taken from the request.
//
// STATUS: disabled by default (see providers.js, AI_ENABLE_ANTHROPIC). The
// request the SDK builds is covered by tests with a fake fetch, but it has not
// been checked against the live API with a real key. Enable it only after that
// check.
//
// The call uses only what the installed SDK supports: the plain, non-beta
// `messages.create` with model, max_tokens, system and messages. Beta features
// (server-side refusal fallbacks) need a newer SDK and are not used; a refusal
// is reported as the `refused` error instead.
//
// Security: the key is passed to the SDK client for this one request only. SDK
// error objects are never logged or returned; they are mapped to fixed
// categories with the HTTP status.

const Anthropic = require('@anthropic-ai/sdk');
const { AiError } = require('./errors');

// `fetch` is only for tests (a fake transport, so no network or key is needed).
async function callAnthropic({ apiKey, model, system, user, maxTokens, timeoutMs, fetch }) {
  // No SDK retries: a retry would multiply the wait past the gateway timeout.
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });

  let response;
  try {
    response = await client.messages.create({
      model,
      // The caller's limit (e.g. 900 for the decoder, 1200 for guidance).
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)       throw new AiError('invalid_key', 401);
    if (err instanceof Anthropic.PermissionDeniedError)     throw new AiError('permission_denied', 403);
    if (err instanceof Anthropic.RateLimitError)            throw new AiError('rate_limited', 429);
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('timeout');
    if (err instanceof Anthropic.APIConnectionError)        throw new AiError('provider_unavailable');
    if (err instanceof Anthropic.InternalServerError)       throw new AiError('provider_unavailable', err.status);
    if (err instanceof Anthropic.APIError)                  throw new AiError('provider_error', err.status);
    throw new AiError('provider_error');
  }

  // Check the stop reason before reading content: a refusal has no usable text,
  // and a reply cut off at max_tokens is incomplete (the JSON would not parse).
  if (response?.stop_reason === 'refusal')    throw new AiError('refused');
  if (response?.stop_reason === 'max_tokens') throw new AiError('bad_output');

  const text = (response?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
  if (!text) throw new AiError('bad_output');
  return text;
}

module.exports = { callAnthropic };
