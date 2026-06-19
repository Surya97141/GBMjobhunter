// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const WEB_APP_URL = 'http://localhost:5173';

// Ring SVG math: r=36, C = 2π × 36 ≈ 226.19
const RING_C = 2 * Math.PI * 36;

// ─── STATE IDS ────────────────────────────────────────────────────────────────

const ALL_STATES = ['auth', 'idle', 'job', 'filling'];

// ─── CURRENT JOB (carried across states) ──────────────────────────────────────

let currentJob = null; // { company, role, fields }

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
