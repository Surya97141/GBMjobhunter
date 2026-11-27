// Recovery for failed lazy-chunk loads after a redeploy ("version skew").
//
// Every route is a lazy chunk with content-hashed file names. A tab that loaded
// index.html before a new deployment still asks for the OLD chunk names when the
// user navigates; the new deployment no longer has them, so the dynamic import
// (and its CSS preload) fails. Vite reports both failures through one window
// event, `vite:preloadError`. Reloading fetches the current index.html, which
// references chunks that exist. A short guard window stops a reload loop when
// the failure is not skew (offline, blocked request): the second failure is left
// to reach the ErrorBoundary, which shows a recoverable message.
//
// Pure helpers are exported separately so they can be unit-tested in Node.

export const RELOAD_STORAGE_KEY = 'gbm_chunk_reload_at';
export const RELOAD_GUARD_MS    = 10_000;

// True if no reload was attempted within the guard window.
export function shouldReloadForChunkError(now, lastAttemptAt, guardMs = RELOAD_GUARD_MS) {
  const last = Number(lastAttemptAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last > guardMs;
}

// Messages browsers and Vite use when a dynamic import or its CSS fails to load.
const CHUNK_ERROR_RE = new RegExp(
  [
    'Failed to fetch dynamically imported module',   // Chromium
    'error loading dynamically imported module',     // Firefox
    'Importing a module script failed',              // Safari
    'Unable to preload CSS',                         // Vite CSS preload
    'Expected a JavaScript(-or-Wasm)? module script', // wrong MIME (HTML served for JS)
  ].join('|'),
  'i'
);

export function isChunkLoadError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return typeof message === 'string' && CHUNK_ERROR_RE.test(message);
}

export function installChunkReloadHandler(win = window) {
  win.addEventListener('vite:preloadError', (event) => {
    let last = null;
    try { last = win.sessionStorage.getItem(RELOAD_STORAGE_KEY); } catch { /* storage blocked */ }

    const now = Date.now();
    if (!shouldReloadForChunkError(now, last)) return; // let the ErrorBoundary handle it

    try { win.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now)); } catch { /* storage blocked */ }
    event.preventDefault(); // don't surface the error; the reload replaces this page
    win.location.reload();
  });
}
