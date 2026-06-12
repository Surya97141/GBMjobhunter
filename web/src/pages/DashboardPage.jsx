import ATSRing from '../components/dashboard/ATSRing';
import ApplicationList from '../components/dashboard/ApplicationList';
import InsightCards from '../components/dashboard/InsightCards';
import { Display, Body } from '../components/Typography';
import styles from './DashboardPage.module.css';

const QUICK_STATS = [
  { value: '47', label: 'Total Applied'  },
  { value: '3',  label: 'Interviews'     },
  { value: '28', label: 'Ghosted'        },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1" className={styles.greeting}>
          {getGreeting()}, Alex.
        </Display>
        <Body color="secondary">Here&apos;s your job search at a glance.</Body>
      </header>

      <div className={styles.topRow}>
        <div className={styles.atsCard}>
          <ATSRing score={72} />
        </div>
        <div className={styles.statsGrid}>
          {QUICK_STATS.map((s) => (
            <div key={s.label} className={styles.statCard}>
              <span className={styles.statValue}>{s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.listCard}>
        <ApplicationList />
      </div>

      <InsightCards />

    </main>
  );
}
