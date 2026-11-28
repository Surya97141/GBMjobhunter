// What the Insights globe needs from the browser, and what to say when it is
// missing. Pure helpers (the canvas factory is injected) so they run under
// node --test.

// Pinned to the installed three-globe version and to https, so the page never
// asks for the image over plain http or gets a different file after an
// upstream release. three-globe's package exports do not allow importing its
// bundled images, so the texture comes from the CDN; if it fails, the globe
// still renders as a plain sphere with its markers.
export const GLOBE_TEXTURE_URL = 'https://unpkg.com/three-globe@2.45.2/example/img/earth-night.jpg';

// 'webgl2' | 'webgl' | null. Creating a context can throw (blocked by policy,
// GPU blocklist, lost context), which three.js would otherwise raise while
// React renders, taking the whole page down.
export function detectWebGL(createCanvas) {
  try {
    const canvas = createCanvas?.();
    if (!canvas?.getContext) return null;
    if (canvas.getContext('webgl2')) return 'webgl2';
    if (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) return 'webgl';
    return null;
  } catch {
    return null;
  }
}

export function browserSupportsWebGL() {
  if (typeof document === 'undefined') return false;
  return detectWebGL(() => document.createElement('canvas')) !== null;
}

// User-facing explanations for each way the map can fail. The list view and
// the personalized search list below the map keep working in every case.
export const GLOBE_FAILURE_MESSAGES = Object.freeze({
  webgl:   'The 3D map could not start because WebGL is unavailable or turned off in this browser. The same data is shown as a list instead.',
  render:  'The 3D map stopped with an error. The same data is shown as a list instead.',
  chunk:   'The map component could not be downloaded. Check your connection and reload the page. Personalized searches below still work.',
  texture: 'The map imagery could not be loaded, so the globe is shown without it. Markers and data still work.',
});

export function globeFailureMessage(reason) {
  return GLOBE_FAILURE_MESSAGES[reason] ?? GLOBE_FAILURE_MESSAGES.render;
}

// Message for a failed GET /jobs/demand-supply, by HTTP status.
export function demandLoadMessage(err) {
  const status = err?.response?.status;
  if (status === 401) return 'Your session has expired. Sign in again to load skill demand data.';
  if (status >= 500 || !status) return 'Skill demand data could not be loaded (the service did not respond). Try reloading the page.';
  return 'Skill demand data could not be loaded. Try reloading the page.';
}
