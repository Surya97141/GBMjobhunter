const test   = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, loadContent, EXTENSION_ID } = require('./helpers');

const TRUSTED = 'http://localhost:5173';

function trustedSender(overrides = {}) {
  return {
    id: EXTENSION_ID,
    tab: { id: 7 },
    frameId: 0,
    origin: TRUSTED,
    url: `${TRUSTED}/dashboard`,
    ...overrides,
  };
}

function storedToken(chrome) {
  return chrome.sets.find(s => 'auth_token' in s)?.auth_token;
}

test.describe('background GBM_SET_TOKEN', () => {
  test('stores the token from the trusted web app content script', () => {
    const { chrome, onMessage } = loadBackground();
    onMessage({ type: 'GBM_SET_TOKEN', token: 'good.jwt' }, trustedSender(), () => {});
    assert.equal(storedToken(chrome), 'good.jwt');
  });

  test('falls back to sender.url when sender.origin is not provided', () => {
    const { chrome, onMessage } = loadBackground();
    onMessage({ type: 'GBM_SET_TOKEN', token: 'good.jwt' }, trustedSender({ origin: undefined }), () => {});
    assert.equal(storedToken(chrome), 'good.jwt');
  });

  const rejected = {
    'an untrusted page origin':      { origin: 'https://evil.example', url: 'https://evil.example/x' },
    'a lookalike origin':            { origin: 'http://localhost:5174', url: 'http://localhost:5174/' },
    'a sub-frame':                   { frameId: 3 },
    'a non-tab sender':              { tab: undefined },
    'another extension':             { id: 'other-extension' },
    'no origin and an unparsable url': { origin: undefined, url: 'not a url' },
  };
  for (const [name, overrides] of Object.entries(rejected)) {
    test(`ignores the token from ${name}`, () => {
      const { chrome, onMessage } = loadBackground();
      onMessage({ type: 'GBM_SET_TOKEN', token: 'planted.jwt' }, trustedSender(overrides), () => {});
      assert.equal(storedToken(chrome), undefined);
    });
  }

  test('ignores a non-string token even from the trusted sender', () => {
    const { chrome, onMessage } = loadBackground();
    onMessage({ type: 'GBM_SET_TOKEN', token: { not: 'a string' } }, trustedSender(), () => {});
    assert.equal(storedToken(chrome), undefined);
  });
});

test.describe('content script token relay', () => {
  function relayed(chrome) {
    return chrome.sets.filter(s => s.sent?.type === 'GBM_SET_TOKEN').map(s => s.sent.token);
  }

  test('relays GBM_SET_TOKEN posted by the trusted web app', () => {
    const { chrome, postMessage } = loadContent({ origin: TRUSTED });
    postMessage({ type: 'GBM_SET_TOKEN', token: 'good.jwt' });
    assert.deepEqual(relayed(chrome), ['good.jwt']);
  });

  test('does not relay GBM_SET_TOKEN posted on an arbitrary page', () => {
    const { chrome, postMessage } = loadContent({ origin: 'https://jobs.evil.example' });
    postMessage({ type: 'GBM_SET_TOKEN', token: 'planted.jwt' });
    assert.deepEqual(relayed(chrome), []);
  });

  test('does not relay messages from another window', () => {
    const { chrome, postMessage } = loadContent({ origin: TRUSTED });
    postMessage({ type: 'GBM_SET_TOKEN', token: 'x' }, { source: {} });
    assert.deepEqual(relayed(chrome), []);
  });

  test('does not relay a non-string token', () => {
    const { chrome, postMessage } = loadContent({ origin: TRUSTED });
    postMessage({ type: 'GBM_SET_TOKEN', token: 123 });
    assert.deepEqual(relayed(chrome), []);
  });
});
