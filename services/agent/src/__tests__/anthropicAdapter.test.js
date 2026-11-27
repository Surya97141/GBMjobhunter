// Runs the Anthropic adapter against the REAL installed @anthropic-ai/sdk with a
// fake fetch: no network and no real key. This checks the HTTP request the SDK
// actually builds (endpoint, auth header, body, no beta headers) and how real
// SDK errors are mapped. It cannot show that the live API accepts the request;
// that is why the provider stays disabled by default (AI_ENABLE_ANTHROPIC).

const { callAnthropic } = require('../services/ai/anthropic.adapter');

const FAKE_KEY = 'sk-ant-FAKE-TEST-KEY-0000000000000000';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return typeof response === 'function' ? response() : response;
  };
  fn.calls = calls;
  return fn;
}

function headersOf(init) {
  const h = new Headers(init.headers);
  return Object.fromEntries(h.entries());
}

const ARGS = { apiKey: FAKE_KEY, model: 'claude-opus-5-5', system: 'sys', user: 'hello', maxTokens: 900, timeoutMs: 5000 };

it('sends a plain Messages API request with the caller\'s max_tokens', async () => {
  const fetch = fakeFetch(jsonResponse(200, {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    stop_reason: 'end_turn', content: [{ type: 'text', text: ' Hello there. ' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  const text = await callAnthropic({ ...ARGS, fetch });

  expect(text).toBe('Hello there.');
  expect(fetch.calls).toHaveLength(1); // maxRetries: 0
  const { url, init } = fetch.calls[0];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(String(init.method).toUpperCase()).toBe('POST');

  const headers = headersOf(init);
  expect(headers['x-api-key']).toBe(FAKE_KEY);
  expect(headers['anthropic-version']).toBeDefined();
  expect(headers['anthropic-beta']).toBeUndefined();

  expect(JSON.parse(init.body)).toEqual({
    model: 'claude-opus-5-5',
    max_tokens: 900,
    system: 'sys',
    messages: [{ role: 'user', content: 'hello' }],
  });
});

it.each([
  [401, 'invalid_key'],
  [403, 'permission_denied'],
  [429, 'rate_limited'],
  [500, 'provider_unavailable'],
  [400, 'provider_error'],
])('maps a real SDK error for HTTP %i to %s without the provider message', async (status, code) => {
  // Error bodies can echo part of the key; the mapped error must not carry it.
  const fetch = fakeFetch(() => jsonResponse(status, {
    type: 'error', error: { type: 'some_error', message: `bad key ${FAKE_KEY}` },
  }));

  const err = await callAnthropic({ ...ARGS, fetch }).catch(e => e);

  expect(err.name).toBe('AiError');
  expect(err.code).toBe(code);
  expect(err.message).not.toContain(FAKE_KEY);
  expect(JSON.stringify(err)).not.toContain(FAKE_KEY);
});

it('maps a network failure to provider_unavailable', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const err = await callAnthropic({ ...ARGS, fetch }).catch(e => e);
  expect(err.code).toBe('provider_unavailable');
});

it('treats a reply cut off at max_tokens as unusable', async () => {
  const fetch = fakeFetch(jsonResponse(200, {
    id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary": "cut' }],
    usage: { input_tokens: 1, output_tokens: 900 },
  }));
  const err = await callAnthropic({ ...ARGS, fetch }).catch(e => e);
  expect(err.code).toBe('bad_output');
});
