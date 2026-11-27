import { useState, useEffect, useRef } from 'react';
import { Display } from '../components/Typography';
import client from '../api/client';
import AiSettingsPanel from '../components/ai/AiSettingsPanel';
import { useAiSettings } from '../context/AiSettingsContext';
import { aiFailureMessage } from '../utils/aiFailureMessage';
import OpportunityPlanner from '../components/opportunities/OpportunityPlanner';
import styles from './OpportunitiesPage.module.css';

// ─── Hidden Curriculum Decoder ────────────────────────────────────────────────

// value = exact string validated by server's CURRICULUM_TOPICS Set.
// label = display text only — never sent to the server.
const TOPICS = [
  { value: 'behavioral round',                  label: 'Behavioral round'              },
  { value: 'recruiter first-30-seconds screen', label: 'Recruiter 30-second screen'    },
  { value: 'talking about a project',           label: 'Talking about a project'       },
  { value: 'what culture fit means',            label: 'What "culture fit" means'     },
  { value: 'following up after an interview',   label: 'Following up after interview'   },
];

// Shared extraction logic duplicated from popup.js extractModelText —
// intentional: web app (Vite) and extension (MV3, no build step) have no
// shared module system between them.
function extractText(result) {
  const tier2 = result.data?.choices?.[0]?.message?.content;
  if (typeof tier2 === 'string' && tier2.trim()) return tier2.trim();
  const tier3 = result.data?.content?.[0]?.text;
  if (typeof tier3 === 'string' && tier3.trim()) return tier3.trim();
  return '';
}

function HiddenCurriculumDecoder() {
  const ai = useAiSettings();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [text,     setText]     = useState('');
  const [source,   setSource]   = useState('');
  const [msg,      setMsg]      = useState('');
  const outputRef = useRef(null);

  async function handleDecode() {
    if (!selected || loading || !ai.aiPayload) return;
    setLoading(true);
    setText('');
    setSource('');
    setMsg('');

    try {
      const res = await client.post(
        '/agent/explain-hiring-process',
        { topic: selected, ai: ai.aiPayload },
        { timeout: 35000 },
      );
      const result = res.data;

      if (result.success === true) {
        const explanation = result.text ?? extractText(result);
        if (explanation) {
          setText(explanation);
          setSource(result.providerLabel ?? '');
          setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        } else {
          setMsg('The AI response was empty. Try again.');
        }
      } else {
        setMsg(result.message || 'Could not generate right now — try again in a moment.');
      }
    } catch (err) {
      setMsg(aiFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.decoderSection}>
      <h2 className={styles.sectionTitle}>Hidden Curriculum Decoder</h2>
      <p className={styles.sectionHint}>
        What the hiring process actually tests — explained using your real skills as the example.
      </p>

      <div className={styles.topicPicker} role="group" aria-label="Select a topic">
        {TOPICS.map(({ value, label }) => (
          <button
            key={value}
            className={`${styles.topicBtn} ${selected === value ? styles.topicBtnActive : ''}`}
            onClick={() => { setSelected(value); setText(''); setMsg(''); }}
            disabled={loading}
            aria-pressed={selected === value}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        className={styles.decodeBtn}
        onClick={handleDecode}
        disabled={!selected || loading || !ai.aiPayload}
      >
        {loading ? 'Decoding…' : 'Decode this'}
      </button>
      {!ai.aiPayload && (
        <p className={styles.decoderMsg}>Choose an AI provider above to use the decoder.</p>
      )}

      {text && (
        <div ref={outputRef} className={styles.decoderOutput}>
          <p className={styles.aiLabel}>AI-generated{source ? ` by ${source}` : ''}. It can be wrong; use it as a starting point.</p>
          <p className={styles.decoderText}>{text}</p>
        </div>
      )}

      {msg && <p className={styles.decoderMsg}>{msg}</p>}
    </section>
  );
}

// ─── Level badge colours via data-level attribute ─────────────────────────────
// foundational = green (approachable), intermediate = amber, advanced = red
const LEVEL_STYLE = {
  foundational: { bg: 'var(--color-high-subtle)', color: 'var(--color-high)' },
  intermediate: { bg: 'var(--color-mid-subtle)',  color: 'var(--color-mid)'  },
  advanced:     { bg: 'var(--color-low-subtle)',  color: 'var(--color-low)'  },
};

const PLATFORM_LABEL = {
  discord: 'Discord',
  slack:   'Slack',
  forum:   'Forum',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkillCard({ rec }) {
  const ls = LEVEL_STYLE[rec.level] ?? LEVEL_STYLE.intermediate;

  return (
    <li className={styles.skillCard}>
      <div className={styles.skillCardTop}>
        <span className={styles.skillName}>{rec.skill}</span>
        <div className={styles.badgeRow}>
          <span className={styles.badge} style={{ background: ls.bg, color: ls.color }}>
            {rec.level}
          </span>
          <span className={styles.domainBadge}>{rec.domain}</span>
        </div>
      </div>

      <p className={styles.buildsOn}>
        {rec.matchedPrerequisites?.length
          ? <>Builds on your: <strong>{rec.matchedPrerequisites.join(', ')}</strong></>
          : 'A starting point: no prerequisites needed.'}
      </p>

      {rec.courses && rec.courses.length > 0 && (
        <ul className={styles.courseList}>
          {rec.courses.map((course, i) => (
            <li key={i} className={styles.courseItem}>
              <a
                href={course.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.courseLink}
              >
                {course.title}
                {course.platform && (
                  <span className={styles.coursePlatform}> · {course.platform}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      {rec.dataSource === "cohort" && rec.reason && (
        <p className={styles.skillReason}>{rec.reason}</p>
      )}
    </li>
  );
}

function CommunityCard({ community }) {
  const platform = PLATFORM_LABEL[community.platform] ?? community.platform;

  return (
    <li className={styles.communityCard}>
      <div className={styles.communityTop}>
        <span className={styles.communityName}>{community.name}</span>
        <span className={styles.platformBadge}>{platform}</span>
      </div>
      <p className={styles.communityDesc}>{community.description}</p>
      <a
        href={community.joinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.joinLink}
      >
        Join community →
      </a>
    </li>
  );
}

// Empty states depend on whether resume skills were available: telling someone
// who already uploaded a resume to "upload a resume" would be misleading.
function EmptyRecs({ hasSkills }) {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyHeadline}>No recommendations yet</p>
      <p className={styles.emptyBody}>
        {hasSkills
          ? 'No skill recommendations match the skills in your resume yet.'
          : 'Upload a resume on the Profile page so we can tailor suggestions to your skill set.'}
      </p>
    </div>
  );
}

// ─── AI explanation of the recommendations ───────────────────────────────────
// Optional. Sends the recommendations (and, server side, the resume skills and
// target role) to the selected provider and shows a grounded explanation. The
// backend drops anything about skills that were not recommended and strips links.
function AiGuidance({ recommendations }) {
  const ai = useAiSettings();
  const [state,  setState]  = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [msg,    setMsg]    = useState('');

  if (recommendations.length === 0) return null;

  async function explain() {
    if (!ai.aiPayload || state === 'loading') return;
    setState('loading');
    setMsg('');
    try {
      const res = await client.post('/agent/ai/opportunity-guidance', {
        ai: ai.aiPayload,
        recommendations: recommendations.map(r => ({
          skill:    r.skill,
          level:    r.level,
          domain:   r.domain,
          buildsOn: r.matchedPrerequisites ?? [],
        })),
      }, { timeout: 35000 });
      if (res.data?.success) {
        setResult(res.data);
        setState('done');
      } else {
        setMsg(res.data?.message || 'Could not generate an explanation right now.');
        setState('error');
      }
    } catch (err) {
      setMsg(aiFailureMessage(err));
      setState('error');
    }
  }

  return (
    <section className={styles.decoderSection} aria-labelledby="ai-guidance-title">
      <h2 id="ai-guidance-title" className={styles.sectionTitle}>Why these skills?</h2>
      <p className={styles.sectionHint}>
        Optional: an AI explanation of the recommendations above, based only on your resume skills,
        your target role and the list itself. It adds no new courses, links or job listings.
      </p>

      <button
        type="button"
        className={styles.decodeBtn}
        onClick={explain}
        disabled={!ai.aiPayload || state === 'loading'}
      >
        {state === 'loading' ? 'Explaining…' : state === 'done' ? 'Explain again' : 'Explain these recommendations'}
      </button>
      {!ai.aiPayload && (
        <p className={styles.decoderMsg}>Choose an AI provider above to get an explanation.</p>
      )}
      {state === 'error' && <p className={styles.decoderMsg} role="alert">{msg}</p>}

      {state === 'done' && result?.guidance && (
        <div className={styles.decoderOutput}>
          <p className={styles.aiLabel}>
            AI-generated by {result.providerLabel}. It can be wrong; check it against your own experience.
          </p>
          {result.guidance.summary && <p className={styles.decoderText}>{result.guidance.summary}</p>}
          {result.guidance.items.length > 0 && (
            <ul className={styles.guidanceList}>
              {result.guidance.items.map(item => (
                <li key={item.skill}>
                  <strong>{item.skill}</strong>: {item.explanation}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const [recommendations, setRecommendations] = useState([]);
  const [communities,     setCommunities]     = useState([]);
  const [hasSkills,       setHasSkills]       = useState(false);
  const [resumeSkills,    setResumeSkills]    = useState([]);
  // Parsed resume and profile, kept in memory for the AI planner. Neither is
  // sent to an AI provider unless the user reviews it and presses Send.
  const [resume,          setResume]          = useState(null);
  const [user,            setUser]            = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);

  useEffect(() => {
    async function load() {
      try {
        // Profile (target role, years) for the AI planner only. Optional.
        client.get('/users/me')
          .then(res => setUser(res.data?.data?.user ?? null))
          .catch(() => {});

        // Try to personalise by reading the user's parsed resume skills.
        let skillsParam = '';
        try {
          const resumeRes = await client.get('/users/me/resume');
          const parsed    = resumeRes.data?.data?.resume ?? null;
          // Only the parsed fields the planner reads; raw resume text is not kept.
          if (parsed) setResume({ skills: parsed.skills, workExperience: parsed.workExperience, education: parsed.education });
          const skills    = parsed?.skills ?? [];
          if (skills.length > 0) {
            skillsParam = `?skills=${encodeURIComponent(skills.join(','))}`;
            setHasSkills(true);
            setResumeSkills(skills);
          }
        } catch {
          // No resume uploaded — generic recommendations shown instead.
        }

        const [oppsRes, commRes] = await Promise.all([
          client.get(`/opportunities${skillsParam}`),
          client.get(`/opportunities/communities${skillsParam}`),
        ]);

        setRecommendations(oppsRes.data?.data?.recommendations ?? []);
        setCommunities(commRes.data?.data?.communities        ?? []);
      } catch {
        setError('Could not load opportunities. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loadingText}>Loading opportunities…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.page}>
        <p className={styles.errorText}>{error}</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>

      <header className={styles.pageHeader}>
        <Display as="h1" className={styles.pageTitle}>Opportunities</Display>
        <p className={styles.pageSubtitle}>
          Skills to learn next and communities to join, worked out from the skills in your resume.
        </p>
        <p className={styles.basedOn}>
          {hasSkills
            ? <>Based on your resume skills: <strong>{resumeSkills.join(', ')}</strong></>
            : 'No resume skills found, so these are general starting points. Upload a resume on the Profile page to personalise them.'}
        </p>
      </header>

      <div className={styles.grid}>

        {/* Left — Skill Recommendations */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Skill Recommendations</h2>
          <p className={styles.sectionHint}>
            Ranked by how many of your existing skills lead into each one. No AI is used for this list.
          </p>

          {recommendations.length === 0 ? (
            <EmptyRecs hasSkills={hasSkills} />
          ) : (
            <ul className={styles.skillList}>
              {recommendations.map(rec => (
                <SkillCard key={rec.skill} rec={rec} />
              ))}
            </ul>
          )}
        </section>

        {/* Right — Communities */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Communities</h2>
          <p className={styles.sectionHint}>
            Matching Discord and Slack communities based on your skill set.
          </p>

          {communities.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyHeadline}>No matching communities</p>
              <p className={styles.emptyBody}>
                {hasSkills
                  ? 'No communities match the skills in your resume yet.'
                  : 'Upload a resume and we will match you to relevant communities.'}
              </p>
            </div>
          ) : (
            <ul className={styles.communityList}>
              {communities.map(c => (
                <CommunityCard key={c.name} community={c} />
              ))}
            </ul>
          )}
        </section>

      </div>

      <AiSettingsPanel dataSent="only the data each feature names: the profile you review (personalized opportunities), your resume skills, target role and the recommended skills (explanations), or the chosen topic (decoder)," />

      <OpportunityPlanner
        resume={resume}
        user={user}
        recommendations={recommendations}
        communities={communities}
      />

      <AiGuidance recommendations={recommendations} />

      <HiddenCurriculumDecoder />

    </main>
  );
}

