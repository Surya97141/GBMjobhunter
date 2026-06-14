import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { animate } from 'framer-motion';
import client from '../api/client';
import InsightCards from '../components/dashboard/InsightCards';
import styles from './DashboardPage.module.css';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width = '100%', height = 20, circle = false }) {
  return (
    <div
      className={styles.skeleton}
      style={{ width, height, borderRadius: circle ? '50%' : 8 }}
    />
  );
}

// ─── Counting number ──────────────────────────────────────────────────────────

function CountUp({ target, duration = 800 }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const controls = animate(0, target, {
      duration: duration / 1000,
      ease: 'easeOut',
      onUpdate: v => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, duration]);

  return <span>{value}</span>;
}

// ─── ATS Ring ─────────────────────────────────────────────────────────────────

function DashboardATSRing({ score }) {
  const circumference = 2 * Math.PI * 60;
  const [displayScore, setDisplayScore] = useState(0);
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    if (!score || score === 0) { setOffset(circumference); return; }
    const controls = animate(0, score, {
      duration: 1.2,
      ease: 'easeOut',
      onUpdate: (v) => {
        setDisplayScore(Math.round(v));
        setOffset(circumference * (1 - v / 100));
      },
    });
    return () => controls.stop();
  }, [score, circumference]);

  const strokeColour = !score || score === 0
    ? 'var(--border-strong)'
    : score >= 70 ? 'var(--color-high)'
    : score >= 40 ? 'var(--color-mid)'
    : 'var(--color-low)';

  const description = !score || score === 0 ? null
    : score >= 70 ? 'Strong keyword match'
    : score >= 40 ? 'Moderate — room to improve'
    : 'Weak — update your resume';

  return (
    <div className={styles.ringWrapper}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="60" fill="none" stroke="var(--border-subtle)" strokeWidth="8" />
        <circle
          cx="80" cy="80" r="60"
          fill="none"
          stroke={strokeColour}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 80 80)"
        />
        <foreignObject x="30" y="55" width="100" height="50">
          <div className={styles.ringCenter}>
            {(!score || score === 0)
              ? <Link to="/dashboard/profile" className={styles.ringLink}>Upload resume</Link>
              : <><span className={styles.ringScore}>{displayScore}</span><span className={styles.ringDenom}>/100</span></>
            }
          </div>
        </foreignObject>
      </svg>
      <p className={styles.ringLabel}>ATS Score</p>
      <p className={styles.ringDesc}>
        {description ?? 'No resume yet'}
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function outcomeStyle(outcome) {
  const map = {
    pending:   { label: 'Applied',   bg: 'var(--bg-surface)',       color: 'var(--text-muted)'  },
    interview: { label: 'Interview', bg: 'var(--color-mid-subtle)', color: 'var(--color-mid)'   },
    offer:     { label: 'Offer',     bg: 'var(--color-high-subtle)', color: 'var(--color-high)' },
    rejected:  { label: 'Rejected',  bg: 'var(--color-low-subtle)', color: 'var(--color-low)'   },
    ghosted:   { label: 'Ghosted',   bg: 'var(--bg-surface)',       color: 'var(--text-muted)'  },
  };
  return map[outcome] ?? map.pending;
}

function atsBadgeStyle(score) {
  if (score === null || score === undefined) {
    return { label: '—', bg: 'var(--bg-surface)', color: 'var(--text-muted)' };
  }
  if (score >= 70) return { label: String(score), bg: 'var(--color-high-subtle)', color: 'var(--color-high)' };
  if (score >= 40) return { label: String(score), bg: 'var(--color-mid-subtle)',  color: 'var(--color-mid)'  };
  return              { label: String(score), bg: 'var(--color-low-subtle)',  color: 'var(--color-low)'  };
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [user,       setUser]       = useState(null);
  const [stats,      setStats]      = useState(null);
  const [recentApps, setRecentApps] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [errors,     setErrors]     = useState({});

  useEffect(() => {
    // Each call has its own .catch so a single failure doesn't wipe out other data.
    Promise.all([
      client.get('/users/me')              .catch(e => ({ _err: e })),
      client.get('/applications/stats')    .catch(e => ({ _err: e })),
      client.get('/applications?limit=6')  .catch(e => ({ _err: e })),
    ]).then(([userRes, statsRes, appsRes]) => {
      const errs = {};

      if (userRes._err)  errs.user  = 'Could not load profile.';
      else setUser(userRes.data?.data?.user ?? null);

      if (statsRes._err) errs.stats = 'Could not load stats.';
      else setStats(statsRes.data?.data?.stats ?? null);

      if (appsRes._err)  errs.apps  = 'Could not load recent applications.';
      else setRecentApps(appsRes.data?.data?.applications ?? []);

      setErrors(errs);
      setLoading(false);
    });
  }, []);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning'
    : hour < 17 ? 'Good afternoon'
    : hour < 21 ? 'Good evening'
    : 'Good night';

  const displayName = user?.name || user?.email?.split('@')[0] || 'there';
  const subtitle    = user?.target_role
    ? `Here's your ${user.target_role} search at a glance.`
    : `Here's your job search at a glance.`;

  const STAT_CARDS = [
    { value: stats?.total      ?? 0, label: 'Total Applied' },
    { value: stats?.interviews ?? 0, label: 'Interviews'    },
    { value: stats?.ghosted    ?? 0, label: 'Ghosted'       },
    { value: stats?.offers     ?? 0, label: 'Offers'        },
  ];

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className={styles.content}>
        <Skeleton height={52} width={360} />
        <Skeleton height={20} width={280} />
        <div className={styles.topRow}>
          <Skeleton width={160} height={160} circle />
          <div className={styles.statsGrid}>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} height={80} />)}
          </div>
        </div>
        <div className={styles.listCard}>
          <Skeleton height={24} width={200} />
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} height={48} style={{ marginBottom: 8 }} />
          ))}
        </div>
      </main>
    );
  }

  // ── Loaded ────────────────────────────────────────────────────────────────
  return (
    <main className={styles.content}>

      {errors.user && (
        <div className={styles.inlineError}>{errors.user}</div>
      )}

      <header className={styles.pageHeader}>
        <h1 className={styles.greeting}>{greeting}, {displayName}.</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>

      <div className={styles.topRow}>
        <DashboardATSRing score={user?.ats_score_cache} />
        <div className={styles.statsGrid}>
          {errors.stats
            ? <p className={styles.inlineError}>{errors.stats}</p>
            : STAT_CARDS.map(({ value, label }) => (
                <div key={label} className={styles.statCard}>
                  <span className={styles.statValue}><CountUp target={value} /></span>
                  <span className={styles.statLabel}>{label}</span>
                </div>
              ))
          }
        </div>
      </div>

      <div className={styles.listCard}>
        <h2 className={styles.sectionHead}>Recent Applications</h2>

        {errors.apps ? (
          <p className={styles.inlineError}>{errors.apps}</p>
        ) : recentApps.length === 0 ? (
          <p className={styles.emptyState}>
            {!user?.ats_score_cache
              ? <>Upload your resume first, then use the browser extension to log your first application.{' '}
                  <Link to="/dashboard/profile" className={styles.link}>Go to Profile →</Link></>
              : 'No applications yet. Use the browser extension on a job page to log your first one.'
            }
          </p>
        ) : (
          <>
            <div className={styles.appList}>
              {recentApps.map((app, i) => {
                const outcome = outcomeStyle(app.outcome);
                const ats     = atsBadgeStyle(app.ats_score_at_apply);
                return (
                  <div
                    key={app.id}
                    className={`${styles.appRow} ${i === recentApps.length - 1 ? styles.lastRow : ''}`}
                  >
                    <div className={styles.appLeft}>
                      <span className={styles.company}>{app.company_name}</span>
                      <span className={styles.role}>{app.role_title}</span>
                      <span className={styles.date}>{formatDate(app.applied_at)}</span>
                    </div>
                    <div className={styles.appRight}>
                      <span
                        className={styles.pill}
                        style={{ background: ats.bg, color: ats.color }}
                      >
                        {ats.label}
                      </span>
                      <span
                        className={styles.pill}
                        style={{ background: outcome.bg, color: outcome.color }}
                      >
                        {outcome.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link to="/dashboard/applications" className={styles.viewAll}>
              View all applications →
            </Link>
          </>
        )}
      </div>

      <InsightCards />

    </main>
  );
}
