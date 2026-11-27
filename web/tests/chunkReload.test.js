import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELOAD_STORAGE_KEY,
  installChunkReloadHandler,
  isChunkLoadError,
  shouldReloadForChunkError,
} from '../src/utils/chunkReload.js';

test('recognises the chunk-load errors from the production report and other browsers', () => {
  // Exact messages reported from production (Firefox + Vite preload helper).
  assert.ok(isChunkLoadError(new Error('error loading dynamically imported module: https://gbmjobhunter-web.vercel.app/assets/RegisterPage-BNvBo_3r.js')));
  assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/AuthPage-Dt_gGqgc.css')));
  // Chromium and Safari wording.
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/A.js')));
  assert.ok(isChunkLoadError('Importing a module script failed.'));
});

test('does not treat ordinary errors as chunk-load errors', () => {
  assert.equal(isChunkLoadError(new TypeError('e.map is not a function')), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError({}), false);
});

test('reload guard: allows the first attempt, blocks a repeat inside the window', () => {
  assert.equal(shouldReloadForChunkError(100_000, null), true);
  assert.equal(shouldReloadForChunkError(100_000, ''), true);
  assert.equal(shouldReloadForChunkError(100_000, 'garbage'), true);
  assert.equal(shouldReloadForChunkError(100_000, String(95_000)), false); // 5 s ago
  assert.equal(shouldReloadForChunkError(100_000, String(80_000)), true);  // 20 s ago
});

function fakeWindow() {
  const store = new Map();
  const listeners = {};
  return {
    reloads: 0,
    sessionStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    location: { reload() { this.owner.reloads += 1; } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatch(type) {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      listeners[type]?.(event);
      return event;
    },
    store,
  };
}

test('vite:preloadError reloads once, then lets a repeated failure through', () => {
  const win = fakeWindow();
  win.location.owner = win;
  installChunkReloadHandler(win);

  const first = win.dispatch('vite:preloadError');
  assert.equal(win.reloads, 1);
  assert.equal(first.defaultPrevented, true);
  assert.ok(win.store.get(RELOAD_STORAGE_KEY));

  // A second failure right after the reload (e.g. offline) must not loop.
  const second = win.dispatch('vite:preloadError');
  assert.equal(win.reloads, 1);
  assert.equal(second.defaultPrevented, false);
});

test('still reloads when sessionStorage is unavailable', () => {
  const win = fakeWindow();
  win.location.owner = win;
  win.sessionStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  installChunkReloadHandler(win);
  win.dispatch('vite:preloadError');
  assert.equal(win.reloads, 1);
});
