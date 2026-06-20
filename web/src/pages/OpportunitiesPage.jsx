import { useState, useEffect, useRef } from 'react';
import client from '../api/client';
import styles from './OpportunitiesPage.module.css';

// ─── Hidden Curriculum Decoder ────────────────────────────────────────────────

// value = exact string validated by server's CURRICULUM_TOPICS Set.
// label = display text only — never sent to the server.
const TOPICS = [
  { value: 'behavioral round',                  label: 'Behavioral round'              },
  { value: 'recruiter first-30-seconds screen', label: 'Recruiter 30-second screen'    },
  { value: 'talking about a project',           label: 'Talking about a project'       },
  { value: 'what culture fit means',            label: 'What “culture fit” means'     },
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
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [text,     setText]     = useState('');
  const [msg,      setMsg]      = useState('');
  const outputRef = useRef(null);

  async function handleDecode() {
    if (!selected || loading) return;
    setLoading(true);
    setText('');
    setMsg('');

    try {
      const res    = await client.post('/agent/explain-hiring-process', { topic: selected }, { timeout: 30000 });
      const result = res.data;

      if (result.success === true) {
        const explanation = extractText(result);
        if (explanation) {
          setText(explanation);
          setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
      } else if (result.error === ‘not_configured’) {
        setMsg("AI decoding isn’t set up yet — a Tier 2 model needs to be configured.");
      } else {
        setMsg("Couldn’t generate right now — try again in a moment.");
      }
    } catch {
      setMsg("Couldn’t generate right now — try again in a moment.");
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
        disabled={!selected || loading}
      >
        {loading ? 'Decoding…' : 'Decode this'}
      </button>

      {text && (
        <div ref={outputRef} className={styles.decoderOutput}>
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

function EmptyRecs() {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyHeadline}>No recommendations yet</p>
      <p className={styles.emptyBody}>
        Upload a resume on the Profile page so we can tailor suggestions to your skill set.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const [recommendations, setRecommendations] = useState([]);
  const [communities,     setCommunities]     = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);

  useEffect(() => {
    async function load() {
      try {
        // Try to personalise by reading the user's parsed resume skills.
        let skillsParam = '';
        try {
          const resumeRes = await client.get('/users/me/resume');
          const skills    = resumeRes.data?.data?.resume?.skills ?? [];
          if (skills.length > 0) {
            skillsParam = `?skills=${encodeURIComponent(skills.join(','))}`;
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
        <h1 className={styles.pageTitle}>Opportunities</h1>
        <p className={styles.pageSubtitle}>
          Skills to learn next and communities to join — personalised to your resume.
        </p>
      </header>

      <div className={styles.grid}>

        {/* Left — Skill Recommendations */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Skill Recommendations</h2>
          <p className={styles.sectionHint}>
            Ranked by how many of your existing skills lead into each one.
          </p>

          {recommendations.length === 0 ? (
            <EmptyRecs />
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
                Upload a resume and we will match you to relevant communities.
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

      <HiddenCurriculumDecoder />

    </main>
  );
}
