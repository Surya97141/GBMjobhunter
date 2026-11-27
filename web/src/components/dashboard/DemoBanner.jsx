import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import styles from './DemoBanner.module.css';

// Shown across the top of the dashboard only for demo accounts. Makes the
// boundaries explicit: the data is synthetic, it is temporary, and some parts
// of the project are not part of the hosted demo.
export default function DemoBanner() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user?.is_demo) return null;

  // Clear the session, then do a full page load of the landing page. A client-side
  // navigate('/') races ProtectedRoute: once the token is gone it redirects to
  // /login before the landing route renders, so a reviewer who exits the demo
  // would land on a sign-in form. A hard load is deterministic and also drops
  // any in-memory demo state.
  function exitDemo() {
    logout();
    window.location.assign('/');
  }

  return (
    <div className={styles.banner} role="region" aria-label="Demo information">
      <div className={styles.bar}>
        <span className={styles.badge}>DEMO</span>
        <span className={styles.text}>
          Sample data only. This account is temporary and is deleted automatically after a few hours.
        </span>
        <button
          type="button"
          className={styles.link}
          aria-expanded={open}
          aria-controls="demo-guide"
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'Hide guide' : 'Demo guide'}
        </button>
        <button type="button" className={styles.link} onClick={exitDemo}>
          Exit demo
        </button>
      </div>

      {open && (
        <div id="demo-guide" className={styles.guide}>
          <h2 className={styles.heading}>Try this</h2>
          <ol className={styles.steps}>
            <li><strong>Tracker:</strong> open the Tracker and drag an application to a new column. Your change is saved to this demo account.</li>
            <li><strong>Dashboard:</strong> go back and see the counts reflect what you moved, then scroll to the insight cards. They come from synthetic sample cohorts, not real market data.</li>
            <li><strong>Insights tab:</strong> a map built from sample skill-demand data seeded for the demo.</li>
          </ol>

          <h2 className={styles.heading}>What this demo covers</h2>
          <ul className={styles.status}>
            <li><strong>Live:</strong> application tracking, dashboard and profile, backed by a real database and API gateway.</li>
            <li><strong>Sample-driven:</strong> insights and cohort numbers are pre-seeded, not computed from real applicants.</li>
            <li><strong>Rule-based, no AI:</strong> resume parsing and the profile suggestions it produces.</li>
            <li><strong>Optional AI:</strong> explanations on the Opportunities page use either the shared demo key (if the host has one configured) or your own API key, which stays in this tab&apos;s memory.</li>
            <li><strong>Separate install:</strong> the Chrome extension (form auto-fill) and the mobile app are not part of this hosted demo.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
