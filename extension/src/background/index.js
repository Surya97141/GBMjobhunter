// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const API_BASE   = 'http://localhost:8080'; // gateway — updated to prod URL in Phase 10
const STORAGE_KEY_TOKEN   = 'auth_token';
const STORAGE_KEY_PROFILE = 'user_profile';

// ─── MESSAGE TYPES ────────────────────────────────────────────────────────────

const MSG = {
  GET_PAGE_STATE:       'GET_PAGE_STATE',
  START_AUTOFILL:       'START_AUTOFILL',
  LOG_APPLICATION:      'LOG_APPLICATION',
  FILL_PROGRESS:        'FILL_PROGRESS',
  APPLICATION_SUBMITTED:'APPLICATION_SUBMITTED',
};

// ─── MOCK PROFILE (Phase 10: replaced by real profile from user service) ──────

const MOCK_PROFILE = {
  firstName: 'Alex',
  lastName:  'Johnson',
  email:     'alex@example.com',
  phone:     '+1 555 0100',
  linkedin:  'https://linkedin.com/in/alexjohnson',
  website:   'https://alexjohnson.dev',
  location:  'San Francisco, CA',
  coverLetter: '',
};

// ─── MAIN MESSAGE ROUTER ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case MSG.GET_PAGE_STATE:
      handleGetPageState(sendResponse);
      return true; // keeps channel open for async response

    case MSG.START_AUTOFILL:
      handleStartAutofill(sendResponse);
      return true;

    case MSG.LOG_APPLICATION:
      handleLogApplication(message.data, sendResponse);
      return true;

    // Content script broadcasts progress — background relays to any open popup
    case MSG.FILL_PROGRESS:
    case MSG.APPLICATION_SUBMITTED:
      // Already received by popup directly; no action needed in background
      break;
  }
});

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleGetPageState(sendResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);

  if (!tab?.id) {
    sendResponse(null);
    return;
  }

  try {
    // Ask the content script what it sees on the current page
    const pageState = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_STATE });
    sendResponse(pageState ?? null);
  } catch (_) {
    // Content script not loaded (non-matching URL, chrome:// page, etc.)
    sendResponse(null);
  }
}

async function handleStartAutofill(sendResponse) {
  // Load the user's saved profile; fall back to mock during development
  const stored = await chrome.storage.local.get(STORAGE_KEY_PROFILE).catch(() => ({}));
  const profile = stored[STORAGE_KEY_PROFILE] ?? MOCK_PROFILE;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);

  if (!tab?.id) {
    sendResponse({ ok: false, error: 'No active tab' });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.START_AUTOFILL, profile });
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleLogApplication(data, sendResponse) {
  const stored = await chrome.storage.local.get(STORAGE_KEY_TOKEN).catch(() => ({}));
  const token  = stored[STORAGE_KEY_TOKEN];

  if (!token) {
    sendResponse({ ok: false, error: 'Not authenticated' });
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/jobs/applications`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      sendResponse({ ok: false, error: body.error ?? `HTTP ${res.status}` });
      return;
    }

    const body = await res.json().catch(() => ({}));
    sendResponse({ ok: true, ...body });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
