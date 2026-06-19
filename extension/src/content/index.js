// ─── FIELD TYPES ──────────────────────────────────────────────────────────────

const FIELD = {
  FIRST_NAME:   'FIRST_NAME',
  LAST_NAME:    'LAST_NAME',
  FULL_NAME:    'FULL_NAME',
  EMAIL:        'EMAIL',
  PHONE:        'PHONE',
  LINKEDIN:     'LINKEDIN',
  WEBSITE:      'WEBSITE',
  LOCATION:     'LOCATION',
  COVER_LETTER: 'COVER_LETTER',
  RESUME:       'RESUME',
  UNKNOWN:      'UNKNOWN',
};

// Human-readable labels shown in the popup field list
const FIELD_LABELS = {
  [FIELD.FIRST_NAME]:   'First name',
  [FIELD.LAST_NAME]:    'Last name',
  [FIELD.FULL_NAME]:    'Full name',
  [FIELD.EMAIL]:        'Email address',
  [FIELD.PHONE]:        'Phone number',
  [FIELD.LINKEDIN]:     'LinkedIn URL',
  [FIELD.WEBSITE]:      'Portfolio / website',
  [FIELD.LOCATION]:     'Location',
  [FIELD.COVER_LETTER]: 'Cover letter',
  [FIELD.RESUME]:       'Resume / CV',
  [FIELD.UNKNOWN]:      'Other field',
};

// ─── LABEL RESOLUTION ─────────────────────────────────────────────────────────

// Builds a single string of all label-related text for an element.
// Used by the classifier regexes — prevents repetitive DOM queries.
function getLabelText(el) {
  const parts = [];

  // 1. Explicit <label for="id">
  if (el.id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (explicit) parts.push(explicit.textContent);
  }

  // 2. Wrapping <label>
  const wrapping = el.closest('label');
  if (wrapping) parts.push(wrapping.textContent);

  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel);

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach(id => {
      const ref = document.getElementById(id);
      if (ref) parts.push(ref.textContent);
    });
  }

  // 5. Nearby text — first short sibling or parent text node (catches div-wrapped labels)
  const parent = el.parentElement;
  if (parent) {
    const sibling = parent.querySelector('span, label, p, div');
    if (sibling && sibling !== el && sibling.textContent.length < 80) {
      parts.push(sibling.textContent);
    }
  }

  return parts.join(' ');
}

// ─── FIELD CLASSIFIER ─────────────────────────────────────────────────────────

// Rules are checked in order — first match wins.
// Each rule tests the combined hint string: name + id + placeholder + label text.
const CLASSIFICATION_RULES = [
  {
    type: FIELD.EMAIL,
    test: (el, hint) =>
      el.type === 'email' || /\bemail/i.test(hint),
  },
  {
    type: FIELD.PHONE,
    test: (el, hint) =>
      el.type === 'tel' || /phone|mobile|\btel\b/i.test(hint),
  },
  {
    type: FIELD.RESUME,
    test: (el, hint) =>
      el.type === 'file' && /resume|curriculum|cv\b/i.test(hint + el.accept),
  },
  {
    type: FIELD.COVER_LETTER,
    test: (el, hint) =>
      el.tagName === 'TEXTAREA' && /cover.?letter|why.+(apply|join|us)|tell us/i.test(hint),
  },
  {
    type: FIELD.FIRST_NAME,
    test: (el, hint) =>
      el.autocomplete === 'given-name' ||
      /first.?name|given.?name|forename/i.test(hint),
  },
  {
    type: FIELD.LAST_NAME,
    test: (el, hint) =>
      el.autocomplete === 'family-name' ||
      /last.?name|surname|family.?name/i.test(hint),
  },
  {
    type: FIELD.FULL_NAME,
    test: (el, hint) =>
      el.autocomplete === 'name' ||
      /^(full.?)?name$|your name/i.test(hint.trim()),
  },
  {
    type: FIELD.LINKEDIN,
    test: (_el, hint) => /linkedin/i.test(hint),
  },
  {
    type: FIELD.WEBSITE,
    test: (_el, hint) => /website|portfolio|github|personal.?url/i.test(hint),
  },
  {
    type: FIELD.LOCATION,
    test: (el, hint) =>
      /^(street-address|address-level2|postal-code)$/.test(el.autocomplete) ||
      /\b(location|city|address|postcode|zip)\b/i.test(hint),
  },
];

function classifyField(el) {
  const hint = [
    el.name        ?? '',
    el.id          ?? '',
    el.placeholder ?? '',
    getLabelText(el),
  ].join(' ');

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(el, hint)) return rule.type;
  }

  return FIELD.UNKNOWN;
}

// ─── FORM DETECTION ───────────────────────────────────────────────────────────

// Finds the best candidate for a job application form on the page.
// Returns the <form> element, or null if none looks like a job application.
function detectApplicationForm() {
  const forms = Array.from(document.querySelectorAll('form'));

  for (const form of forms) {
    const inputs = Array.from(
      form.querySelectorAll('input:not([type="hidden"]), textarea, select')
    );
    if (inputs.length < 3) continue;

    // A submit button with application language is a strong signal
    const buttons = Array.from(
      form.querySelectorAll('button, input[type="submit"]')
    );
    const hasApplyButton = buttons.some(b =>
      /apply|submit.*(application|form)?/i.test(b.textContent + b.value)
    );

    // An email input is another strong signal
    const hasEmailInput = inputs.some(i =>
      i.type === 'email' || /email/i.test(i.name + i.placeholder)
    );

    if (hasApplyButton || hasEmailInput) return form;
  }

  return null;
}

// Classifies every fillable input in a form.
// Returns an array of { element, type, label } objects.
function classifyFormFields(form) {
  const inputs = Array.from(
    form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea')
  );

  return inputs
    .map(el => ({
      element: el,
      type:    classifyField(el),
      label:   FIELD_LABELS[classifyField(el)],
    }))
    .filter(f => f.type !== FIELD.UNKNOWN);
}

// ─── JOB DESCRIPTION TEXT EXTRACTION ─────────────────────────────────────────

// Returns the visible text of the job description section (capped at 5 000 chars
// to keep the POST /applications/score payload small).  Tries common selectors
// used by major job boards before falling back to the full body text.
function extractJobText() {
  const SELECTORS = [
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="job_description"]',
    '[id*="job-description"]',
    '[data-test*="job-description"]',
    '[class*="description--"]',
    'article',
    'main',
  ];

  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 100) {
      return el.innerText.slice(0, 5000);
    }
  }

  return document.body.innerText.slice(0, 5000);
}

// ─── JOB METADATA EXTRACTION ──────────────────────────────────────────────────

function extractJobMeta() {
  // 1. JSON-LD (most structured — used by most job boards)
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const job  = data['@type'] === 'JobPosting' ? data
                 : Array.isArray(data['@graph'])
                   ? data['@graph'].find(n => n['@type'] === 'JobPosting')
                   : null;
      if (job?.title) {
        return {
          role:    job.title,
          company: job.hiringOrganization?.name ?? '',
          location: job.jobLocation?.address?.addressLocality ?? '',
        };
      }
    } catch (_) {}
  }

  // 2. OG title — e.g. "Senior Engineer at Stripe | LinkedIn"
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content ?? '';
  const atMatch = ogTitle.match(/^(.+?)\s+at\s+(.+?)(?:\s+[|·\-]|$)/i);
  if (atMatch) {
    return { role: atMatch[1].trim(), company: atMatch[2].trim(), location: '' };
  }

  // 3. Page <title> fallback
  const titleMatch = document.title.match(/^(.+?)\s+at\s+(.+?)(?:\s+[|·\-]|$)/i);
  if (titleMatch) {
    return { role: titleMatch[1].trim(), company: titleMatch[2].trim(), location: '' };
  }

  return { role: '', company: '', location: '' };
}

// ─── JD FINGERPRINT ───────────────────────────────────────────────────────────

// Browser-side equivalent of services/jobs/src/utils/fingerprint.js hashJD().
// Same normalisation (trim + lowercase) → SHA-256 → first 16 hex chars.
// Produces byte-identical output — so extension and server agree on the same hash.
async function hashJD(jdText) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(jdText.trim().toLowerCase())
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// ─── AUTO-FILL ────────────────────────────────────────────────────────────────

// Maps a classified field type to a value from the user's profile
function profileValueFor(profile, fieldType) {
  switch (fieldType) {
    case FIELD.FIRST_NAME:   return profile.firstName;
    case FIELD.LAST_NAME:    return profile.lastName;
    case FIELD.FULL_NAME:    return `${profile.firstName} ${profile.lastName}`;
    case FIELD.EMAIL:        return profile.email;
    case FIELD.PHONE:        return profile.phone;
    case FIELD.LINKEDIN:     return profile.linkedin;
    case FIELD.WEBSITE:      return profile.website;
    case FIELD.LOCATION:     return profile.location;
    case FIELD.COVER_LETTER: return profile.coverLetter;
    default:                 return null;
  }
}

// Fills one input element.
// Native value setter + synthetic events is the only reliable way to trigger
// React's onChange — direct assignment bypasses the synthetic event system.
function fillElement(el, value) {
  if (!value) return;

  const isTextarea = el.tagName === 'TEXTAREA';
  const proto      = isTextarea
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  nativeSetter.call(el, value);

  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fills all classified fields sequentially with a small delay between each.
// Progress is broadcast to the popup after each filled field.
async function autofill(profile, fields) {
  const fillable = fields.filter(f => f.type !== FIELD.RESUME);
  const total    = fillable.length;
  let   filled   = 0;

  for (const { element, type, label } of fillable) {
    const value = profileValueFor(profile, type);
    if (!value) continue;

    // 120ms between fills — feels deliberate, prevents React batching issues
    await wait(120);
    fillElement(element, value);
    filled++;

    chrome.runtime.sendMessage({
      type:   'FILL_PROGRESS',
      filled,
      total,
      fieldLabel: label,
    });
  }
}

// ─── SUBMIT DETECTION ─────────────────────────────────────────────────────────

function watchForSubmission(form, jobMeta) {
  form.addEventListener('submit', () => {
    chrome.runtime.sendMessage({
      type: 'APPLICATION_SUBMITTED',
      data: {
        company:     jobMeta.company,
        role:        jobMeta.role,
        url:         window.location.href,
        submittedAt: new Date().toISOString(),
      },
    });
  });
}

// ─── PAGE STATE ───────────────────────────────────────────────────────────────

let currentForm          = null;
let currentFields        = [];
let currentMeta          = {};
let currentJdFingerprint = null; // cached SHA-256 hash, computed once at page detection
let currentGhostScore    = null; // cached result sent back by the background service worker

function refreshPageState() {
  currentForm = detectApplicationForm();
  if (!currentForm) {
    currentFields        = [];
    currentMeta          = {};
    currentJdFingerprint = null;
    currentGhostScore    = null;
    return null;
  }

  currentFields = classifyFormFields(currentForm);
  currentMeta   = extractJobMeta();
  watchForSubmission(currentForm, currentMeta);

  const jdText = extractJobText();

  // Compute the fingerprint once on first detection (async, non-blocking).
  // On subsequent calls (e.g. popup re-opening) currentJdFingerprint is already
  // populated and this block is skipped.
  if (jdText && !currentJdFingerprint) {
    hashJD(jdText).then(hash => {
      currentJdFingerprint = hash;
      // Ask the background to fetch the ghost score using its stored JWT.
      // Fire-and-forget: background responds via GHOST_SCORE_RESULT message.
      chrome.runtime.sendMessage({
        type:              'REQUEST_GHOST_SCORE',
        jdFingerprintHash: hash,
        companyName:       currentMeta.company || '',
      });
    });
  }

  return {
    isJobPage:         true,
    company:           currentMeta.company,
    role:              currentMeta.role,
    jdText,
    jdFingerprintHash: currentJdFingerprint,  // null on very first call; hash on all subsequent
    ghostScore:        currentGhostScore,      // null until background responds
    fields:            currentFields.map(f => ({ type: f.type, label: f.label })),
  };
}

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case 'GET_PAGE_STATE':
      sendResponse(refreshPageState());
      break;

    case 'START_AUTOFILL':
      autofill(message.profile, currentFields)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // async

    case 'GHOST_SCORE_RESULT':
      // Background fetched the score and sends it back here for caching.
      // Next GET_PAGE_STATE response will include it.
      currentGhostScore = message.data;
      break;

    default:
      break;
  }
});

// ─── TOKEN HANDOFF RELAY ──────────────────────────────────────────────────────

// When the content script is injected into the web app (localhost:5173), the web
// app calls window.postMessage({ type: 'GBM_SET_TOKEN', token }) after login.
// This listener catches that message and forwards it to the background service
// worker, which stores it in chrome.storage.local.
// On production job-board pages this listener is a no-op — messages of type
// 'GBM_SET_TOKEN' will never originate there.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'GBM_SET_TOKEN' && event.data?.token) {
    chrome.runtime.sendMessage({ type: 'GBM_SET_TOKEN', token: event.data.token });
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

// Run once on page load to initialise state.
// SPA navigation won't trigger this again — the popup calls GET_PAGE_STATE
// each time it opens, which calls refreshPageState() fresh each time.
refreshPageState();
