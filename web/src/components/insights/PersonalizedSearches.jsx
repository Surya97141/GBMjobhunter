import { useId, useMemo, useReducer, useRef, useState } from 'react';
import client from '../../api/client';
import { useAiSettings } from '../../context/AiSettingsContext';
import AiSettingsPanel from '../ai/AiSettingsPanel';
import { aiFailureMessage } from '../../utils/aiFailureMessage';
import { buildAiProfile, hasEnoughProfile, readPlanResponse, LIMITS } from '../../utils/aiProfile';
import {
  buildGlobeProfile, describeGlobeProfile, personalizeReducer, INITIAL_PERSONALIZE_STATE, termsFromPlan,
} from '../../utils/jobSearchLinks';
import styles from './Insights.module.css';

// "Personalize the map": turns the user's reviewed resume profile into role
// search terms, using the existing validated opportunity-plan request
// (POST /agent/ai/opportunity-plan) with the selected AI provider.
//
// Nothing is fetched or sent on page load. The resume is read from this app's
// own API only when the user starts personalizing, and nothing reaches the AI
// provider until they have reviewed the exact fields and pressed Send. The
// provider key stays in AiSettingsContext memory; this component never stores
// or logs it.
//
// onTerms(terms, providerLabel) passes the search terms up to the page, which
// builds the job-board links itself; the model never supplies a URL.

export default function PersonalizedSearches({ onTerms }) {
  const ai = useAiSettings();
  const id = useId();
  const [state, dispatch] = useReducer(personalizeReducer, INITIAL_PERSONALIZE_STATE);
  const [profileState, setProfileState] = useState('idle'); // idle | loading | ready | error
  const [draft, setDraft] = useState(null);
  const [newSkill, setNewSkill] = useState('');
  const sendingRef = useRef(false);

  const profile = useMemo(() => (draft ? buildGlobeProfile(draft) : null), [draft]);
  const enough  = profile ? hasEnoughProfile(profile) : false;
  const canSend = Boolean(ai.aiPayload) && enough && (state.phase === 'reviewing' || state.phase === 'error');

  async function startReview() {
    dispatch({ type: 'review' });
    if (draft) return; // keep the user's edits from an earlier review
    setProfileState('loading');
    const [resumeRes, userRes] = await Promise.allSettled([
      client.get('/users/me/resume'),
      client.get('/users/me'),
    ]);
    const parsed = resumeRes.status === 'fulfilled' ? resumeRes.value.data?.data?.resume ?? null : null;
    const user   = userRes.status === 'fulfilled' ? userRes.value.data?.data?.user ?? null : null;
    if (!parsed && !user) {
      setProfileState('error');
      return;
    }
    // Only the parsed fields buildAiProfile reads; raw text and contact
    // details are never copied into the draft.
    const resume = parsed ? { skills: parsed.skills, workExperience: parsed.workExperience } : null;
    setDraft(buildGlobeProfile(buildAiProfile({ resume, user })));
    setProfileState('ready');
  }

  async function send() {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    dispatch({ type: 'send' });
    try {
      const res = await client.post('/agent/ai/opportunity-plan', { ai: ai.aiPayload, profile }, { timeout: 35000 });
      const plan = readPlanResponse(res.data);
      const result = plan ? termsFromPlan(plan, profile) : { ok: false, message: res.data?.message };
      if (result.ok) {
        const providerLabel = res.data?.providerLabel ?? ai.selected.label;
        dispatch({ type: 'success', terms: result.terms, providerLabel });
        onTerms?.(result.terms, providerLabel);
      } else {
        dispatch({ type: 'failure', message: result.message || 'The AI response could not be used. Try again.' });
      }
    } catch (err) {
      dispatch({ type: 'failure', message: aiFailureMessage(err) });
    } finally {
      sendingRef.current = false;
    }
  }

  function clearSearches() {
    dispatch({ type: 'clear' });
    onTerms?.([], null);
  }

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));
  function addSkill() {
    const value = newSkill.trim();
    if (!value) return;
    update({ skills: [...draft.skills, value] });
    setNewSkill('');
  }

  const reviewing = state.phase === 'reviewing' || state.phase === 'sending' || state.phase === 'error';

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.title}>Personalized job-board searches</h2>
      <p className={styles.hint}>
        Adds labelled markers to the map that open searches on LinkedIn Jobs and Indeed for roles that fit your
        resume. These are <strong>searches, not job listings</strong>: the job board decides what each search
        shows, and this app does not count or compare openings between regions. You review the profile first;
        nothing is sent to an AI provider until you press Send.
      </p>

      {!reviewing && (
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={startReview}>
            {state.phase === 'done' ? 'Review and personalize again' : 'Personalize the map'}
          </button>
          {state.phase === 'done' && (
            <button type="button" className={styles.secondaryBtn} onClick={clearSearches}>Remove search markers</button>
          )}
        </div>
      )}

      {state.phase === 'done' && (
        <p className={styles.success} role="status">
          Search terms from your reviewed profile and {state.providerLabel ?? 'the AI provider'}:{' '}
          <strong>{state.terms.join(' · ')}</strong>. Choose a region below the map, or click a green labelled
          marker on the globe.
        </p>
      )}

      {reviewing && (
        <div className={styles.review}>
          <AiSettingsPanel dataSent="only the reviewed fields listed below: target role, years of experience, skills and past role titles with dates," />

          {profileState === 'loading' && <p className={styles.muted} role="status">Loading your profile…</p>}
          {profileState === 'error' && (
            <p className={styles.error} role="alert">
              Your profile and resume could not be loaded, so there is nothing to review. The skill demand map
              still works. Try again later, or upload a resume on the Profile page.
            </p>
          )}

          {profileState === 'ready' && draft && profile && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Target role</span>
                <input
                  className={styles.input}
                  value={draft.targetRole ?? ''}
                  maxLength={LIMITS.targetRole}
                  onChange={e => update({ targetRole: e.target.value })}
                  placeholder="Not set"
                />
              </label>

              <div className={styles.field}>
                <span className={styles.fieldLabel} id={`${id}-skills`}>Skills from your resume</span>
                {draft.skills.length > 0 ? (
                  <ul className={styles.chips}>
                    {draft.skills.map(skill => (
                      <li key={skill} className={styles.chip}>
                        {skill}
                        <button
                          type="button"
                          className={styles.chipRemove}
                          onClick={() => update({ skills: draft.skills.filter(x => x !== skill) })}
                          aria-label={`Remove ${skill}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className={styles.muted}>No skills found. Add one below or upload a resume on the Profile page.</p>}
                <div className={styles.addRow}>
                  <input
                    className={styles.input}
                    value={newSkill}
                    maxLength={LIMITS.skillLength}
                    onChange={e => setNewSkill(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                    placeholder="Add a skill"
                    aria-labelledby={`${id}-skills`}
                  />
                  <button type="button" className={styles.secondaryBtn} onClick={addSkill}>Add</button>
                </div>
              </div>

              {draft.experience.length > 0 && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Past role titles (company names and descriptions are left out)</span>
                  <ul className={styles.plainList}>
                    {draft.experience.map((exp, i) => (
                      <li key={`${exp.role}-${i}`}>
                        {exp.role}{(exp.start || exp.end) ? ` · ${[exp.start, exp.end].filter(Boolean).join(' to ')}` : ''}{' '}
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => update({ experience: draft.experience.filter((_, j) => j !== i) })}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.preview} data-testid="globe-profile-preview">
                <p className={styles.previewTitle}>
                  Exactly what will be sent to {ai.aiPayload ? ai.selected.label : 'the selected provider'}:
                </p>
                <dl className={styles.previewList}>
                  {describeGlobeProfile(profile).map(({ label, value }) => (
                    <div key={label} className={styles.previewRow}>
                      <dt>{label}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <details className={styles.details}>
                  <summary>Show the exact request data</summary>
                  <pre className={styles.json}>{JSON.stringify(profile, null, 2)}</pre>
                </details>
                <p className={styles.muted}>
                  Never sent: your name, email, phone, location, links, company and school names, role
                  descriptions, education, or the raw resume text.
                </p>
              </div>
            </>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={send} disabled={!canSend}>
              {state.phase === 'sending' ? 'Personalizing…' : `Send to ${ai.aiPayload ? ai.selected.label : 'AI'} and personalize`}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => dispatch({ type: 'cancel' })} disabled={state.phase === 'sending'}>
              Cancel
            </button>
          </div>

          {!ai.aiPayload && (
            <p className={styles.muted} role="status">
              No AI provider is available yet. Choose the shared demo key or enter your own key above to personalize
              the map. The skill demand map works without AI.
            </p>
          )}
          {profileState === 'ready' && !enough && (
            <p className={styles.muted}>Add at least one skill or a target role first.</p>
          )}
          {state.phase === 'sending' && (
            <p className={styles.muted} role="status">Asking {ai.selected.label} for role search terms. This can take up to 30 seconds.</p>
          )}
          {state.phase === 'error' && (
            <p className={styles.error} role="alert">
              {state.message} The skill demand map still works without AI
              {state.terms.length ? ', and your earlier search markers are kept' : ''}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
