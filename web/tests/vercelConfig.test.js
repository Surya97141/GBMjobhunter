// Regression test for the production chunk-loading crash.
//
// The SPA rewrite used to send EVERY unmatched path to /index.html, including
// missing hashed assets. A stale tab asking for an old chunk then received HTML
// with status 200, which the browser rejects as a module script ("error loading
// dynamically imported module") and as a stylesheet ("Unable to preload CSS").
// Missing /assets/* files must 404 instead, while client-side routes still fall
// back to index.html.
//
// Vercel matches `source` with path-to-regexp; a single custom group like
// "/((?!assets/).*)" behaves the same as this anchored RegExp.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both files exist; which one Vercel reads depends on the project's Root
// Directory setting (repo root or web/), so both must be safe.
const CONFIGS = ['../../vercel.json', '../vercel.json'];

function spaRewrite(relPath) {
  const config = JSON.parse(readFileSync(new URL(relPath, import.meta.url), 'utf8'));
  const rewrite = (config.rewrites ?? []).find(r => r.destination === '/index.html');
  assert.ok(rewrite, `${relPath} has an SPA rewrite to /index.html`);
  return new RegExp(`^${rewrite.source}$`);
}

for (const relPath of CONFIGS) {
  test(`${relPath}: missing hashed assets are not rewritten to index.html`, () => {
    const re = spaRewrite(relPath);
    for (const path of [
      '/assets/RegisterPage-BNvBo_3r.js', // file names from the production report
      '/assets/AuthPage-Dt_gGqgc.css',
      '/assets/index-DhE-mAwI.js',
    ]) {
      assert.equal(re.test(path), false, `${path} must 404, not return HTML`);
    }
  });

  test(`${relPath}: client-side routes still fall back to index.html`, () => {
    const re = spaRewrite(relPath);
    for (const path of ['/', '/register', '/login', '/dashboard', '/dashboard/tracker', '/no-such-page', '/assetsfoo']) {
      assert.equal(re.test(path), true, `${path} should be served by the SPA`);
    }
  });
}
