import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import ATSRing from '../components/dashboard/ATSRing';
import ApplicationList from '../components/dashboard/ApplicationList';
import InsightCards from '../components/dashboard/InsightCards';
import { Display, Body } from '../components/Typography';
import styles from './DashboardPage.module.css';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Average ATS score across applications that have one, rounded to nearest int.
function avgAts(apps) {
  const scored = apps.filter(a => a.ats_score_at_apply !== null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, a) => sum + a.ats_score_at_apply, 0) / scored.length);
}

export default function DashboardPage() {
  const { user }       = useAuth();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/applications')
      .then(res => setApps(res.data.data.applications))
      .catch(() => {}) // dashboard stays usable even if fetch fails
      .finally(() => setLoading(false));
  }, []);

  const firstName  = user?.email?.split('@')[0] ?? 'there';
  const totalApps  = apps.length;
  const interviews = apps.filter(a => a.outcome === 'interview' || a.outcome === 'offer').length;
  const ghosted    = apps.filter(a => a.outcome === 'ghosted').length;
  const atsScore   = avgAts(apps);

  const quickStats = [
    { value: String(totalApps),  label: 'Total Applied' },
    { value: String(interviews), label: 'Interviews'    },
    { value: String(ghosted),    label: 'Ghosted'       },
  ];

  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1" className={styles.greeting}>
          {getGreeting()}, {firstName}.
        </Display>
        <Body color="secondary">Here&apos;s your job search at a glance.</Body>
      </header>

      <div className={styles.topRow}>
        <div className={styles.atsCard}>
          <ATSRing score={atsScore ?? 0} />
        </div>
        <div className={styles.statsGrid}>
          {quickStats.map(s => (
            <div key={s.label} className={styles.statCard}>
              <span className={styles.statValue}>{loading ? '—' : s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.listCard}>
        <ApplicationList applications={apps} loading={loading} />
      </div>

      <InsightCards />

    </main>
  );
}
