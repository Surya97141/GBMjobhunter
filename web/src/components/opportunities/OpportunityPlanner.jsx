import { useEffect, useId, useMemo, useRef, useState } from 'react';
import client from '../../api/client';
import { useAiSettings } from '../../context/AiSettingsContext';
import { aiFailureMessage } from '../../utils/aiFailureMessage';
import {
  buildAiProfile, finalizeAiProfile, hasEnoughProfile, describeProfile, validateQuestion,
  curatedResourcesFor, readPlanResponse, readFollowupResponse, LIMITS, QUESTION_MAX,
} from '../../utils/aiProfile';
import styles from './OpportunityPlanner.module.css';

// "Generate personalized opportunities": the one place on this page where the
// selected AI provider does the main work.
//
// Nothing is sent on page load or resume upload. The flow is:
//   1. the user opens the review step, which builds a compact profile from the
//      parsed resume and profile (aiProfile.js: no contact details, no raw text)
//   2. they edit it and see exactly which fields will be sent
//   3. they press Send; the server re-applies the same rules and validates the
//      model's output
//   4. optionally, they ask a bounded follow-up about that guidance.
// Role families are suggestions of kinds of roles, never job openings: this
// app has no live job-listing source.

const FOLLOWUP_COOLDOWN_MS = 5000;

function SkillChips({ skills, onRemove }) {
  return (
    <ul className={styles.chips}>
      {skills.map(skill => (
        <li key={skill} className={styles.chip}>
          {skill}
          <button type="button" className={styles.chipRemove} onClick={() => onRemove(skill)} aria-label={`Remove ${skill}`}>×</button>
        </li>
      ))}
    </ul>
  );
}

function ReviewForm({ draft, setDraft, onReset }) {
  const id = useId();
  const [newSkill, setNewSkill] = useState('');

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));
  const addSkill = () => {
    const value = newSkill.trim();
    if (!value) return;
    update({ skills: [...draft.skills, value] });
    setNewSkill('');
  };

  return (
    <div className={styles.review}>
      <div className={styles.row}>
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
        <label className={`${styles.field} ${styles.narrow}`}>
          <span className={styles.fieldLabel}>Years of experience</span>
          <input
            className={styles.input}
            type="number" min="0" max="60"
            value={draft.yearsOfExperience ?? ''}
            onChange={e => update({ yearsOfExperience: e.target.value === '' ? null : e.target.value })}
            placeholder="Not set"
          />
        </label>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} id={`${id}-skills`}>Skills</span>
        {draft.skills.length > 0
          ? <SkillChips skills={draft.skills} onRemove={s => update({ skills: draft.skills.filter(x => x !== s) })} />
          : <p className={styles.muted}>No skills yet.</p>}
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

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Relevant experience (role, dates and a short highlight; company names are left out)</span>
        {draft.experience.length === 0 && <p className={styles.muted}>None selected from your resume.</p>}
        {draft.experience.map((exp, i) => (
          <div key={i} className={styles.expCard}>
            <div className={styles.expTop}>
              <strong>{exp.role || 'Untitled role'}</strong>
              {(exp.start || exp.end) && <span className={styles.muted}> · {[exp.start, exp.end].filter(Boolean).join(' to ')}</span>}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => update({ experience: draft.experience.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
            <textarea
              className={styles.textarea}
              rows={2}
              maxLength={LIMITS.highlight}
              value={exp.highlights}
              aria-label={`Highlight for ${exp.role || 'this role'}`}
              onChange={e => update({
                experience: draft.experience.map((x, j) => (j === i ? { ...x, highlights: e.target.value } : x)),
              })}
            />
          </div>
        ))}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Education (degree and year; school names are left out)</span>
        {draft.education.length === 0 && <p className={styles.muted}>None found in your resume.</p>}
        <ul className={styles.plainList}>
          {draft.education.map((ed, i) => (
            <li key={i}>
              {ed.degree}{ed.year ? ` (${ed.year})` : ''}{' '}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => update({ education: draft.education.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Achievements (optional, one per line, up to {LIMITS.achievements}). Your resume parser does not extract these, so only what you type here is sent.
        </span>
        <textarea
          className={styles.textarea}
          rows={3}
          value={draft.achievementsText}
          onChange={e => update({ achievementsText: e.target.value })}
          placeholder="e.g. Won a college hackathon with a React app"
        />
      </label>

      <button type="button" className={styles.linkBtn} onClick={onReset}>Reset to my resume data</button>
    </div>
  );
}

function Preview({ profile, providerLabel }) {
  return (
    <div className={styles.preview}>
      <p className={styles.previewTitle}>
        Exactly what will be sent to {providerLabel}:
      </p>
      <dl className={styles.previewList}>
        {describeProfile(profile).map(({ label, value }) => (
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
        Never sent: your name, email, phone, location, links, company and school names, or the raw resume text.
      </p>
    </div>
  );
}

function PlanView({ plan, providerLabel, curated }) {
  return (
    <div className={styles.output}>
      <p className={styles.aiLabel}>
        AI-generated by {providerLabel} from the profile above. It can be wrong; check it against your own experience.
      </p>
      {plan.summary && <p className={styles.summary}>{plan.summary}</p>}

      {plan.roleFamilies.length > 0 && (
        <section>
          <h3 className={styles.outputTitle}>Role families to explore</h3>
          <p className={styles.notice}>
            These are suggestions of kinds of roles, not job openings. This app has no live job listings,
            so nothing here means a role is open or accepting applications.
          </p>
          <ul className={styles.cardList}>
            {plan.roleFamilies.map(r => (
              <li key={r.name} className={styles.card}>
                <div className={styles.cardTop}>
                  <strong>{r.name}</strong>
                  <span className={styles.tag}>Suggestion</span>
                </div>
                <p>{r.why}</p>
                <p className={styles.evidence}>Matches your: {r.matchingSkills.join(', ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.skillGaps.length > 0 && (
        <section>
          <h3 className={styles.outputTitle}>Skill gaps</h3>
          <ul className={styles.cardList}>
            {plan.skillGaps.map(g => {
              const res = curatedResourcesFor(g.skill, curated);
              return (
                <li key={g.skill} className={styles.card}>
                  <strong>{g.skill}</strong>
                  <p>{g.why}</p>
                  <p className={styles.evidence}>Evidence from your profile: {g.evidence.join(', ')}</p>
                  {(res.courses.length > 0 || res.communities.length > 0) && (
                    <div className={styles.curated}>
                      <span className={styles.curatedLabel}>From our curated list:</span>
                      <ul className={styles.plainList}>
                        {res.courses.map(c => (
                          <li key={c.url}>
                            <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a>
                            {c.platform && <span className={styles.muted}> · {c.platform}</span>}
                          </li>
                        ))}
                        {res.communities.map(c => (
                          <li key={c.joinUrl}>
                            <a href={c.joinUrl} target="_blank" rel="noopener noreferrer">{c.name}</a>
                            <span className={styles.muted}> · community</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {plan.nextSteps.length > 0 && (
        <section>
          <h3 className={styles.outputTitle}>Next steps, most important first</h3>
          <ol className={styles.steps}>
            {plan.nextSteps.map(s => (
              <li key={s.priority}>
                {s.action}
                {s.relatedSkill && <span className={styles.muted}> ({s.relatedSkill})</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function FollowUp({ profile, plan }) {
  const ai = useAiSettings();
  const id = useId();
  const [question, setQuestion] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [reply, setReply] = useState(null);
  const [msg, setMsg] = useState('');
  const [coolingDown, setCoolingDown] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const check = validateQuestion(question);
  const tooLong = question.trim().length > QUESTION_MAX;

  async function ask(e) {
    e.preventDefault();
    if (!check.ok || !ai.aiPayload || state === 'loading' || coolingDown) return;
    setState('loading');
    setMsg('');
    try {
      const res = await client.post('/agent/ai/opportunity-followup', {
        ai: ai.aiPayload, profile, plan, question: check.question,
      }, { timeout: 35000 });
      const parsed = readFollowupResponse(res.data);
      if (parsed) {
        setReply(parsed);
        setState('done');
      } else {
        setMsg(res.data?.message || 'The AI response could not be used. Try again.');
        setState('error');
      }
    } catch (err) {
      setMsg(aiFailureMessage(err));
      setState('error');
    } finally {
      setCoolingDown(true);
      timer.current = setTimeout(() => setCoolingDown(false), FOLLOWUP_COOLDOWN_MS);
    }
  }

  return (
    <form className={styles.followup} onSubmit={ask}>
      <label htmlFor={`${id}-q`} className={styles.fieldLabel}>
        Ask a follow-up (optional). Answers use only the profile and guidance above.
      </label>
      <textarea
        id={`${id}-q`}
        className={styles.textarea}
        rows={2}
        value={question}
        maxLength={QUESTION_MAX + 50}
        onChange={e => setQuestion(e.target.value)}
        placeholder="e.g. Which skill gap should I start with, and why?"
        aria-describedby={`${id}-count`}
      />
      <div className={styles.followupBar}>
        <span id={`${id}-count`} className={tooLong ? styles.over : styles.muted}>
          {question.trim().length}/{QUESTION_MAX}
        </span>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={!check.ok || !ai.aiPayload || state === 'loading' || coolingDown}
        >
          {state === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </div>
      {tooLong && <p className={styles.error} role="alert">{check.message}</p>}
      {state === 'error' && <p className={styles.error} role="alert">{msg}</p>}
      {state === 'done' && reply && (
        <div className={styles.answer} aria-live="polite">
          <p className={styles.aiLabel}>AI-generated answer. It can be wrong.</p>
          <p>{reply.answer}</p>
          {reply.outOfScope && (
            <p className={styles.muted}>This question needs information the app does not have, such as live openings.</p>
          )}
        </div>
      )}
    </form>
  );
}

// Editable draft: the profile plus achievements as free text.
function draftFrom(resume, user) {
  return { ...buildAiProfile({ resume, user }), achievementsText: '' };
}

export default function OpportunityPlanner({ resume, user, recommendations, communities }) {
  const ai = useAiSettings();
  const [open,   setOpen]   = useState(false);
  const [draft,  setDraft]  = useState(() => draftFrom(resume, user));
  const [state,  setState]  = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);   // { plan, profileUsed, providerLabel }
  const [msg,    setMsg]    = useState('');
  const outputRef = useRef(null);

  // Rebuild the draft if the resume/profile load after first render, as long
  // as the user has not opened the review step yet.
  useEffect(() => {
    if (!open) setDraft(draftFrom(resume, user));
  }, [resume, user, open]);

  const profile = useMemo(() => finalizeAiProfile({
    ...draft,
    achievements: draft.achievementsText.split('\n'),
  }), [draft]);

  const enough = hasEnoughProfile(profile);
  const canSend = Boolean(ai.aiPayload) && enough && state !== 'loading';

  async function generate() {
    if (!canSend) return;
    setState('loading');
    setMsg('');
    try {
      const res = await client.post('/agent/ai/opportunity-plan', { ai: ai.aiPayload, profile }, { timeout: 35000 });
      const plan = readPlanResponse(res.data);
      if (plan) {
        setResult({ plan, profileUsed: res.data.profileUsed ?? profile, providerLabel: res.data.providerLabel ?? ai.selected.label });
        setState('done');
        setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      } else {
        setMsg(res.data?.message || 'The AI response could not be used. Try again.');
        setState('error');
      }
    } catch (err) {
      setMsg(aiFailureMessage(err));
      setState('error');
    }
  }

  return (
    <section className={styles.section} aria-labelledby="planner-title">
      <h2 id="planner-title" className={styles.title}>Personalized opportunities</h2>
      <p className={styles.hint}>
        Uses your selected AI provider to suggest role families worth exploring, the skill gaps between you and them,
        and prioritized next steps. You review the profile first; nothing is sent until you press Send.
      </p>

      {!open ? (
        <button type="button" className={styles.primaryBtn} onClick={() => setOpen(true)}>
          Generate personalized opportunities
        </button>
      ) : (
        <>
          <ReviewForm draft={draft} setDraft={setDraft} onReset={() => setDraft(draftFrom(resume, user))} />
          <Preview profile={profile} providerLabel={ai.aiPayload ? ai.selected.label : 'the selected provider'} />

          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={generate} disabled={!canSend}>
              {state === 'loading'
                ? 'Generating…'
                : `Send to ${ai.aiPayload ? ai.selected.label : 'AI'} and generate`}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setOpen(false)} disabled={state === 'loading'}>
              Cancel
            </button>
          </div>
          {!ai.aiPayload && (
            <p className={styles.muted}>Choose an AI provider above (shared demo key or your own key) to send this.</p>
          )}
          {!enough && (
            <p className={styles.muted}>Add at least one skill or a target role first.</p>
          )}
          {state === 'loading' && <p className={styles.muted} role="status">Generating guidance. This can take up to 30 seconds.</p>}
          {state === 'error' && <p className={styles.error} role="alert">{msg} The skill recommendations above still work without AI.</p>}
        </>
      )}

      {state === 'done' && result && (
        <div ref={outputRef}>
          <PlanView plan={result.plan} providerLabel={result.providerLabel} curated={{ recommendations, communities }} />
          <FollowUp profile={result.profileUsed} plan={result.plan} />
        </div>
      )}
    </section>
  );
}
