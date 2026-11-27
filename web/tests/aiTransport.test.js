import test from 'node:test';
import assert from 'node:assert/strict';
import { isSecureApiBase, buildAiPayload } from '../src/utils/aiTransport.js';

test('keys may be sent only over HTTPS, or plain HTTP to this machine', () => {
  assert.equal(isSecureApiBase('https://gbm-demo-api.onrender.com'), true);
  assert.equal(isSecureApiBase('http://localhost:3000'), true);
  assert.equal(isSecureApiBase('http://127.0.0.1:3000'), true);
  assert.equal(isSecureApiBase('http://gbm-demo-api.onrender.com'), false);
  assert.equal(isSecureApiBase('http://192.168.1.5:3000'), false);
  assert.equal(isSecureApiBase('not a url'), false);
  assert.equal(isSecureApiBase(undefined), false);
});

const KEY = 'sk-test-0123456789abcdefghij';

test('demo mode needs the server to have a demo key', () => {
  assert.deepEqual(buildAiPayload({ mode: 'demo', demoAvailable: true }), { mode: 'demo' });
  assert.equal(buildAiPayload({ mode: 'demo', demoAvailable: false }), null);
});

test('own-key mode needs a provider, a plausible key and a secure connection', () => {
  const ok = { mode: 'byok', provider: 'anthropic', apiKey: `  ${KEY} `, secureTransport: true };
  assert.deepEqual(buildAiPayload(ok), { mode: 'byok', provider: 'anthropic', apiKey: KEY });
  assert.equal(buildAiPayload({ ...ok, secureTransport: false }), null);
  assert.equal(buildAiPayload({ ...ok, apiKey: 'short' }), null);
  assert.equal(buildAiPayload({ ...ok, provider: 'mistral' }), null);
});

test('the payload never carries anything but mode, provider and key', () => {
  const payload = buildAiPayload({
    mode: 'byok', provider: 'openai', apiKey: KEY, secureTransport: true, baseUrl: 'https://evil.example',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['apiKey', 'mode', 'provider']);
});

test('own-key mode only uses a provider the server offers', () => {
  const ok = { mode: 'byok', provider: 'anthropic', apiKey: KEY, secureTransport: true };
  // The server's status lists Groq and OpenAI only (Anthropic disabled).
  assert.equal(buildAiPayload({ ...ok, allowedProviders: ['groq', 'openai'] }), null);
  assert.deepEqual(
    buildAiPayload({ ...ok, provider: 'openai', allowedProviders: ['groq', 'openai'] }),
    { mode: 'byok', provider: 'openai', apiKey: KEY },
  );
});
