// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000'; // gateway (Fix 1: was 8080)

const STORAGE_KEY_TOKEN      = 'auth_token';
const STORAGE_KEY_PROFILE    = 'user_profile';
const STORAGE_KEY_PROFILE_TS = 'user_profile_ts';
const PROFILE_CACHE_MS       = 24 * 60 * 60 * 1000; // 24 hours

// ─── PROFILE HELPERS ──────────────────────────────────────────────────────────

// Fetches /users/me, maps it to the autofill profile shape, and caches the
// result in chrome.storage.local for 24 hours.  A null return means the user
// has no token or the request failed — show "Sign in" state, no autofill.
async function fetchAndCacheProfile(token) {
  const stored   = await chrome.storage.local
    .get([STORAGE_KEY_PROFILE, STORAGE_KEY_PROFILE_TS])
    .catch(() => ({}));
  const cachedAt = stored[STORAGE_KEY_PROFILE_TS] ?? 0;
  const cached   = stored[STORAGE_KEY_PROFILE];

  if (cached && (Date.now() - cachedAt) < PROFILE_CACHE_MS) {
    return cached;
  }

  try {
    const res = await fetch(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const body = await res.json();
    const user = body?.data?.user;
    if (!user) return null;

    // Map the API user object to the shape content.js expects for field filling.
    // phone / linkedin / website are not stored in the DB yet — left empty so
    // those fields are skipped gracefully rather than filled with mock data.
    const nameParts = (user.name ?? '').trim().split(/\s+/);
    const profile = {
      firstName:           nameParts[0]               ?? '',
      lastName:            nameParts.slice(1).join(' ') ?? '',
      email:               user.email                 ?? '',
      phone:               '',
      linkedin:            '',
      website:             '',
      location:            user.target_location       ?? '',
      coverLetterTemplate: user.cover_letter_template ?? '',
    };

    await chrome.storage.local.set({
      [STORAGE_KEY_PROFILE]:    profile,
      [STORAGE_KEY_PROFILE_TS]: Date.now(),
    });

    return profile;
  } catch {
    return null;
  }
}

// ─── MAIN MESSAGE ROUTER ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'GET_PAGE_STATE':
      handleGetPageState(sendResponse);
      return true;

    case 'START_AUTOFILL':
      handleStartAutofill(sendResponse);
      return true;

    case 'LOG_APPLICATION':
      handleLogApplication(message.data, sendResponse);
      return true;

    // Token handoff: web app content script relays the JWT here after login.
    // Clear the cached profile so the next autofill fetches fresh data.
    case 'GBM_SET_TOKEN':
      if (message.token) {
        chrome.storage.local.set({
          [STORAGE_KEY_TOKEN]:      message.token,
          [STORAGE_KEY_PROFILE]:    null,
          [STORAGE_KEY_PROFILE_TS]: 0,
        });
      }
      break;

    case 'REQUEST_GHOST_SCORE':
      // Response goes back via tabs.sendMessage (fire-and-forget from content script).
      handleRequestGhostScore(message, sender);
      break;

    // Content script broadcasts these — background just lets them pass through
    // to any open popup pages; no action needed here.
    case 'FILL_PROGRESS':
    case 'APPLICATION_SUBMITTED':
      break;
  }
});

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleGetPageState(sendResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.id) { sendResponse(null); return; }

  try {
    const pageState = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATE' });

    // Not a job page — return as-is.
    if (!pageState?.isJobPage) { sendResponse(pageState ?? null); return; }

    // Job page detected: attempt to score the JD text against the user's resume.
    const { auth_token } = await chrome.storage.local
      .get(STORAGE_KEY_TOKEN).catch(() => ({}));

    if (auth_token && pageState.jdText) {
      try {
        const res = await fetch(`${API_BASE}/applications/score`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${auth_token}`,
          },
          body: JSON.stringify({ jdText: pageState.jdText }),
        });
        if (res.ok) {
          const body = await res.json();
          pageState.ats = body?.data?.score ?? null;
        }
      } catch {
        // Score fetch failed — ring stays empty, not a fatal error.
      }
    }

    sendResponse(pageState);
  } catch {
    sendResponse(null);
  }
}

async function handleStartAutofill(sendResponse) {
  const { auth_token } = await chrome.storage.local
    .get(STORAGE_KEY_TOKEN).catch(() => ({}));

  if (!auth_token) {
    sendResponse({ ok: false, error: 'Not authenticated' });
    return;
  }

  const profile = await fetchAndCacheProfile(auth_token);
  if (!profile) {
    sendResponse({ ok: false, error: 'Could not load profile. Sign in on the web app first.' });
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.id) { sendResponse({ ok: false, error: 'No active tab' }); return; }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOFILL', profile });
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleRequestGhostScore(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return;

  // Always sends a terminal GHOST_SCORE_RESULT back to the content script —
  // guarantees the popup never stays on "Checking…" indefinitely.
  function reply(data) {
    chrome.tabs.sendMessage(tabId, { type: 'GHOST_SCORE_RESULT', data }).catch(() => {});
  }

  const { auth_token } = await chrome.storage.local
    .get(STORAGE_KEY_TOKEN).catch(() => ({}));

  if (!auth_token) {
    reply({ label: 'unavailable', reasons: ['Sign in to see ghost risk'] });
    return;
  }

  try {
    const params = new URLSearchParams({ jdFingerprintHash: message.jdFingerprintHash });
    if (message.companyName) params.set('companyName', message.companyName);

    const res = await fetch(`${API_BASE}/jobs/ghost-score?${params}`, {
      headers: { Authorization: `Bearer ${auth_token}` },
    });

    if (!res.ok) {
      reply({ label: 'unavailable', reasons: ['Ghost score temporarily unavailable'] });
      return;
    }

    const body = await res.json().catch(() => null);
    // body.data shape: { score, label, cohortSize, reasons }
    // score is forwarded but never displayed — popup reads label + reasons only.
    reply(body?.data ?? { label: 'unavailable', reasons: ['Unexpected response from server'] });
  } catch {
    reply({ label: 'unavailable', reasons: ['Ghost score temporarily unavailable'] });
  }
}

async function handleLogApplication(data, sendResponse) {
  const { auth_token } = await chrome.storage.local
    .get(STORAGE_KEY_TOKEN).catch(() => ({}));

  if (!auth_token) {
    sendResponse({ ok: false, error: 'Not authenticated' });
    return;
  }

  try {
    // Fix 2: correct gateway path (/applications) and field names the backend expects.
    const res = await fetch(`${API_BASE}/applications`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${auth_token}`,
      },
      body: JSON.stringify({
        companyName: data.company  ?? '',
        roleTitle:   data.role     ?? '',
        jdText:      data.jdText   ?? '',
        pageUrl:     data.url      ?? '',
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      sendResponse({ ok: false, error: body.message ?? `HTTP ${res.status}` });
      return;
    }

    const body = await res.json().catch(() => ({}));
    sendResponse({ ok: true, ...body });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
