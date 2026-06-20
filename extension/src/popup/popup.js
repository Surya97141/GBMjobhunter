// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const WEB_APP_URL = 'http://localhost:5173';
const API_BASE    = 'http://localhost:3000';

// Ring SVG math: r=36, C = 2π × 36 ≈ 226.19
const RING_C = 2 * Math.PI * 36;

// ─── STATE IDS ────────────────────────────────────────────────────────────────

const ALL_STATES = ['auth', 'idle', 'job', 'filling'];

// ─── CURRENT JOB (carried across states) ──────────────────────────────────────

let currentJob = null; // { company, role, fields }

// ─── MODEL TEXT EXTRACTION ────────────────────────────────────────────────────

function extractModelText(result) {
  const tier2 = result.data?.choices?.[0]?.message?.content;
  if (typeof tier2 === 'string' && tier2.trim()) return tier2.trim();
  const tier3 = result.data?.content?.[0]?.text;
  if (typeof tier3 === 'string' && tier3.trim()) return tier3.trim();
  return '';
}

// ─── STATE MACHINE ────────────────────────────────────────────────────────────

function showState(name) {
  ALL_STATES.forEach(id => {
    document.getElementById(`state-${id}`).classList.remove('active');
  });
  document.getElementById(`state-${name}`).classList.add('active');
}

// ─── ATS SCORE HELPERS ────────────────────────────────────────────────────────

function scoreColour(score) {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score >= 80) return 'Good match';
  if (score >= 60) return 'Partial match';
  return 'Low match';
}

function scoreMissing(score) {
  const n = Math.max(0, Math.round((100 - score) / 10));
  return n === 0 ? 'All key skills matched' : `${n} skill${n > 1 ? 's' : ''} missing`;
}

// ─── POPULATE FUNCTIONS ───────────────────────────────────────────────────────

function populateIdle(domain) {
  const el = document.getElementById('current-domain');
  el.textContent = domain ? `Currently on: ${domain}` : '';
  el.style.display = domain ? '' : 'none';
}

function populateJob(job) {
  currentJob = job;

  document.getElementById('job-company').textContent = job.company || 'Unknown company';
  document.getElementById('job-role').textContent    = job.role    || 'Unknown role';

  // ATS ring — use 0 as placeholder until Phase 10 wires up the scoring service
  const score  = job.ats  ?? 0;
  const colour = score > 0 ? scoreColour(score) : '#e5e7eb';
  const offset = score > 0 ? RING_C * (1 - score / 100) : RING_C;

  document.getElementById('ats-ring-fill').setAttribute('stroke-dashoffset', offset.toFixed(2));
  document.getElementById('ats-ring-fill').setAttribute('stroke', colour);

  const scoreText = document.getElementById('ats-score-text');
  scoreText.textContent = score > 0 ? `${score}%` : '—';
  scoreText.setAttribute('fill', colour);

  document.getElementById('ats-label').textContent = score > 0 ? scoreLabel(score)  : 'Score pending';
  document.getElementById('ats-sub').textContent   = score > 0 ? scoreMissing(score) : 'Fetching ATS data…';

  populateGhostScore(job.ghostScore ?? null);
}

function populateGhostScore(ghostScore) {
  const dot       = document.getElementById('ghost-dot');
  const labelEl   = document.getElementById('ghost-label-text');
  const whyBtn    = document.getElementById('ghost-why-btn');
  const reasonsEl = document.getElementById('ghost-reasons');

  dot.className      = 'ghost-dot'; // reset colour modifier
  whyBtn.hidden      = true;
  reasonsEl.hidden   = true;
  reasonsEl.innerHTML = '';

  if (!ghostScore) {
    labelEl.textContent = 'Checking…'; // score still in flight
    return;
  }

  const { label, reasons } = ghostScore;

  if (label === 'insufficient_data') {
    labelEl.textContent = 'Not enough data yet';
    return;
  }

  if (label === 'unavailable') {
    // reasons[0] is a human-readable message set by the background handler
    labelEl.textContent = reasons?.[0] ?? 'Ghost score unavailable';
    return;
  }

  const LABELS = {
    low_risk:      ['low',      'Low risk'],
    moderate_risk: ['moderate', 'Moderate risk'],
    high_risk:     ['high',     'High risk'],
  };
  const [dotClass, text] = LABELS[label] ?? ['', label];

  dot.classList.add(dotClass);
  labelEl.textContent = text;

  if (reasons?.length) {
    reasons.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    });
    whyBtn.hidden = false;
    whyBtn.onclick = () => {
      reasonsEl.hidden   = !reasonsEl.hidden;
      whyBtn.textContent = reasonsEl.hidden ? 'Why?' : 'Hide';
    };
  }
}

function populateFilling(fields) {
  const fillable = (fields ?? []).filter(f => f.type !== 'RESUME');
  const total    = fillable.length;

  document.getElementById('fill-sub').textContent       = currentJob
    ? `${currentJob.company} · ${currentJob.role}`
    : '';
  document.getElementById('progress-fill').style.width  = '0%';
  document.getElementById('progress-label').textContent  = `0 of ${total} fields`;

  const list = document.getElementById('field-list');
  list.innerHTML = '';
  fillable.forEach(f => {
    const li = document.createElement('li');
    li.className   = 'field-item';
    li.textContent = `○ ${f.label}`;
    li.dataset.fieldType = f.type;
    list.appendChild(li);
  });
}

function updateFillProgress(filled, total, fieldLabel) {
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  document.getElementById('progress-fill').style.width   = `${pct}%`;
  document.getElementById('progress-label').textContent   = `${filled} of ${total} fields`;

  // Mark the just-filled field as done, next as active
  const items = Array.from(document.querySelectorAll('#field-list .field-item'));
  let markedDone = 0;
  for (const li of items) {
    if (markedDone < filled) {
      li.className   = 'field-item done';
      li.textContent = `✓ ${li.textContent.replace(/^[○…✓]\s*/, '')}`;
      markedDone++;
    } else if (markedDone === filled) {
      li.className   = 'field-item active';
      li.textContent = `… ${li.textContent.replace(/^[○…✓]\s*/, '')}`;
      break;
    }
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage;

  if (!hasChrome) {
    // Development fallback: show job state with mock data so the UI is visible
    // when opening index.html directly in a browser during development.
    populateJob({ company: 'Stripe', role: 'Senior Frontend Engineer', ats: 87 });
    showState('job');
    return;
  }

  // 1. Auth check
  const { auth_token } = await chrome.storage.local.get('auth_token').catch(() => ({}));
  if (!auth_token) {
    showState('auth');
    return;
  }

  // 2. Ask background for the active tab's page state.
  //    Background asks the content script, which detects forms and extracts job metadata.
  chrome.runtime.sendMessage({ type: 'GET_PAGE_STATE' }, (pageState) => {
    if (chrome.runtime.lastError) {
      // Background not responding (shouldn't happen but handle gracefully)
      showIdle('');
      return;
    }

    if (!pageState?.isJobPage) {
      // Not on a job page — show the idle state with the current domain
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        let domain = '';
        try { domain = new URL(tab?.url ?? '').hostname.replace(/^www\./, ''); } catch (_) {}
        showIdle(domain);
      });
      return;
    }

    populateJob(pageState);
    showState('job');
  });
}

function showIdle(domain) {
  populateIdle(domain);
  showState('idle');
}

// ─── FILL PROGRESS LISTENER ───────────────────────────────────────────────────

// Content script broadcasts FILL_PROGRESS directly to all extension pages.
// The popup receives it here while it's open during an auto-fill session.
chrome.runtime && chrome.runtime.onMessage?.addListener((message) => {
  if (message.type === 'FILL_PROGRESS') {
    updateFillProgress(message.filled, message.total, message.fieldLabel);
  }
  if (message.type === 'APPLICATION_SUBMITTED') {
    const btn = document.getElementById('btn-log');
    if (btn) {
      btn.textContent = '✓ Logged';
      btn.disabled    = true;
    }
    // Return to job state after auto-fill completes
    showState('job');
  }
});

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────

document.getElementById('btn-signin').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url: WEB_APP_URL });
  } else {
    window.open(WEB_APP_URL, '_blank');
  }
});

document.getElementById('link-signup').addEventListener('click', (e) => {
  e.preventDefault();
  const url = `${WEB_APP_URL}/signup`;
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
});

document.getElementById('btn-generate-cl').addEventListener('click', async () => {
  if (!currentJob) return;

  const btn = document.getElementById('btn-generate-cl');
  const msg = document.getElementById('cl-generate-msg');

  btn.disabled    = true;
  btn.textContent = 'Generating…';
  msg.hidden      = true;

  try {
    const { auth_token } = await chrome.storage.local.get('auth_token').catch(() => ({}));

    const res = await fetch(`${API_BASE}/agent/generate-cover-letter`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${auth_token}`,
      },
      body: JSON.stringify({
        role:           currentJob.role    ?? '',
        company:        currentJob.company ?? '',
        jobDescription: currentJob.jdText  ?? '',
      }),
    });

    const result = await res.json();

    if (result.success === true) {
      const text = extractModelText(result);
      if (text) {
        // Fill the cover letter field on the active job page tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'START_AUTOFILL',
            profile: {
              firstName: '', lastName: '', email: '', phone: '',
              linkedin: '', website: '', location: '',
              // Generated text has no placeholders — regex replaces are no-ops
              coverLetterTemplate: text,
            },
          }).catch(() => {});
        }
      }
      // No message on success — the filled field is the visible feedback
    } else if (result.error === 'not_configured') {
      msg.textContent = "AI generation isn’t available yet — your saved template will be used instead.";
      msg.hidden = false;
    } else {
      msg.textContent = "Couldn’t generate right now — your saved template will be used.";
      msg.hidden = false;
    }
  } catch (_) {
    msg.textContent = "Couldn’t generate right now — your saved template will be used.";
    msg.hidden = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Generate tailored cover letter';
  }
});

document.getElementById('btn-contact-toggle').addEventListener('click', () => {
  const fields = document.getElementById('contact-fields');
  fields.hidden = !fields.hidden;
  document.getElementById('btn-contact-toggle').textContent =
    fields.hidden ? '+ Add contact details (optional)' : '− Hide contact details';
});

document.getElementById('btn-generate-outreach').addEventListener('click', async () => {
  if (!currentJob) return;

  const btn     = document.getElementById('btn-generate-outreach');
  const msg     = document.getElementById('outreach-msg');
  const block   = document.getElementById('outreach-block');
  const textEl  = document.getElementById('outreach-text');
  const copyBtn = document.getElementById('btn-copy-outreach');

  btn.disabled    = true;
  btn.textContent = 'Drafting…';
  msg.hidden      = true;
  block.hidden    = true;

  const contactName = document.getElementById('contact-name').value.trim();
  const contactRole = document.getElementById('contact-role').value.trim();

  try {
    const { auth_token } = await chrome.storage.local.get('auth_token').catch(() => ({}));

    const res = await fetch(`${API_BASE}/agent/generate-outreach`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${auth_token}`,
      },
      body: JSON.stringify({
        companyName: currentJob.company ?? '',
        roleTitle:   currentJob.role    ?? '',
        jdText:      currentJob.jdText  ?? '',
        ...(contactName && { contactName }),
        ...(contactRole && { contactRole }),
      }),
    });

    const result = await res.json();

    if (result.success === true) {
      const text = extractModelText(result);
      if (text) {
        textEl.textContent = text;
        block.hidden = false;
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy message'; }, 2000);
        };
      }
    } else if (result.error === 'not_configured') {
      msg.textContent = "AI outreach drafting isn't set up yet.";
      msg.hidden = false;
    } else if (result.error === 'quota_exceeded') {
      msg.textContent = result.message ?? 'Daily outreach limit reached. Resets at midnight UTC.';
      msg.hidden = false;
    } else {
      msg.textContent = "Couldn't draft right now — try again in a moment.";
      msg.hidden = false;
    }
  } catch (_) {
    msg.textContent = "Couldn't draft right now — try again in a moment.";
    msg.hidden = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Draft outreach message';
  }
});

document.getElementById('btn-autofill').addEventListener('click', () => {
  if (!currentJob) return;

  // Show filling state immediately so the user sees feedback right away
  populateFilling(currentJob.fields ?? []);
  showState('filling');

  // Trigger the actual fill via background → content script
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'START_AUTOFILL' }, (res) => {
      if (!res?.ok) {
        // Fill failed — return to job state and re-enable the button
        showState('job');
      }
    });
  }
});

document.getElementById('btn-log').addEventListener('click', () => {
  if (!currentJob) return;
  const btn = document.getElementById('btn-log');

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    btn.textContent = 'Logging…';
    btn.disabled    = true;

    chrome.runtime.sendMessage({
      type: 'LOG_APPLICATION',
      data: {
        company:  currentJob.company,
        role:     currentJob.role,
        jdText:   currentJob.jdText ?? '',
        url:      currentJob.url    ?? '',
        loggedAt: new Date().toISOString(),
      },
    }, (res) => {
      btn.textContent = res?.ok ? '✓ Logged' : 'Log as Applied';
      btn.disabled    = !!res?.ok;
    });
  } else {
    btn.textContent = '✓ Logged';
    btn.disabled    = true;
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  if (currentJob) showState('job');
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────

init();
