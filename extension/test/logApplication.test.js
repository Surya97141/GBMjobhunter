const test   = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('./helpers');

// Sends LOG_APPLICATION through the background router and returns the JSON
// body that was POSTed to /applications plus the response sent to the popup.
async function logApplication(data) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ success: true, data: {} }) };
  };
  const { chrome, onMessage } = loadBackground({ fetch });
  chrome.store.auth_token = 'jwt';

  const response = await new Promise((resolve) => {
    onMessage({ type: 'LOG_APPLICATION', data }, {}, resolve);
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/applications$/);
  return { body: JSON.parse(calls[0].init.body), response };
}

const BASE = { company: 'Acme', role: 'Engineer', jdText: 'JD' };

test('omits pageUrl when the popup sends an empty url', async () => {
  const { body, response } = await logApplication({ ...BASE, url: '' });
  assert.equal('pageUrl' in body, false);
  assert.deepEqual(body, { companyName: 'Acme', roleTitle: 'Engineer', jdText: 'JD' });
  assert.equal(response.ok, true);
});

test('omits pageUrl when url is missing or not an http(s) URL', async () => {
  for (const url of [undefined, null, '   ', 'not a url', 'chrome://extensions', 42]) {
    const { body } = await logApplication({ ...BASE, url });
    assert.equal('pageUrl' in body, false, `url=${String(url)}`);
  }
});

test('sends pageUrl when a valid page URL is present', async () => {
  const url = 'https://boards.greenhouse.io/acme/jobs/123';
  const { body } = await logApplication({ ...BASE, url });
  assert.equal(body.pageUrl, url);
  assert.equal(body.companyName, 'Acme');
  assert.equal(body.roleTitle, 'Engineer');
  assert.equal(body.jdText, 'JD');
});
