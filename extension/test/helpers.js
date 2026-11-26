// Loads the extension's plain browser scripts into a Node vm context with a
// minimal fake `chrome` API, so they can be tested without a browser or any
// extra test dependency.

const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const EXTENSION_ID = 'test-extension-id';

function makeChrome() {
  const listeners = [];
  const sets = [];
  const store = {};
  return {
    listeners,
    sets,
    store,
    api: {
      runtime: {
        id: EXTENSION_ID,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: (msg) => { sets.push({ sent: msg }); return Promise.resolve(); },
      },
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.filter(k => k in store).map(k => [k, store[k]]));
          },
          set: async (obj) => { sets.push(obj); Object.assign(store, obj); },
        },
      },
      tabs: {
        query: async () => [],
        sendMessage: async () => {},
      },
    },
  };
}

function run(context, file) {
  const full = path.join(SRC, file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
}

// Background service worker: config.js is pulled in through importScripts().
function loadBackground({ fetch } = {}) {
  const chrome = makeChrome();
  const context = vm.createContext({ chrome: chrome.api, fetch, URL, URLSearchParams, console });
  context.importScripts = (rel) => run(context, path.join('background', rel));
  run(context, 'background/index.js');
  return { chrome, context, onMessage: chrome.listeners[0] };
}

// Content script: config.js is listed before it in manifest.json.
function loadContent({ origin = 'http://localhost:5173' } = {}) {
  const chrome = makeChrome();
  const windowListeners = {};
  const window = {
    location: { href: `${origin}/dashboard`, origin },
    addEventListener: (type, fn) => { (windowListeners[type] ??= []).push(fn); },
  };
  const document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    title: '',
    body: { innerText: '' },
  };
  const context = vm.createContext({ chrome: chrome.api, window, document, URL, console });
  run(context, 'config.js');
  run(context, 'content/index.js');

  // Simulates window.postMessage arriving at the content script's listener.
  function postMessage(data, { eventOrigin = origin, source = window } = {}) {
    for (const fn of windowListeners.message ?? []) fn({ data, origin: eventOrigin, source });
  }
  return { chrome, window, postMessage };
}

module.exports = { loadBackground, loadContent, EXTENSION_ID };
