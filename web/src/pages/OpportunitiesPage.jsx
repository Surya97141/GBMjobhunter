import { useState, useEffect } from 'react';
import client from '../api/client';
import styles from './OpportunitiesPage.module.css';

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

    </main>
  );
}
