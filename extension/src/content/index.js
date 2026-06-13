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

let currentForm   = null;
let currentFields = [];
let currentMeta   = {};

function refreshPageState() {
  currentForm = detectApplicationForm();
  if (!currentForm) {
    currentFields = [];
    currentMeta   = {};
    return null;
  }

  currentFields = classifyFormFields(currentForm);
  currentMeta   = extractJobMeta();
  watchForSubmission(currentForm, currentMeta);

  return {
    isJobPage: true,
    company:   currentMeta.company,
    role:      currentMeta.role,
    fields:    currentFields.map(f => ({ type: f.type, label: f.label })),
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

    default:
      break;
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

// Run once on page load to initialise state.
// SPA navigation won't trigger this again — the popup calls GET_PAGE_STATE
// each time it opens, which calls refreshPageState() fresh each time.
refreshPageState();
