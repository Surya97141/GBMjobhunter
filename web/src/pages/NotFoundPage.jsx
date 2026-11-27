import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import authStyles from './AuthPage.module.css';
import styles from './NotFoundPage.module.css';

// Catch-all for unknown URLs. `inApp` renders inside the dashboard layout
// (next to the sidebar) for unknown /dashboard/* paths; otherwise it is a
// standalone page styled like the sign-in screen.
export default function NotFoundPage({ inApp = false }) {
  const { token } = useAuth();

  if (inApp) {
    return (
      <main className={styles.inApp}>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.sub}>This dashboard page doesn&apos;t exist.</p>
        <Link to="/dashboard" className={styles.link}>Back to dashboard</Link>
      </main>
    );
  }

  return (
    <main className={authStyles.page} data-theme="obsidian">
      <div className={authStyles.card}>
        <div className={authStyles.logo}>GBM</div>
        <h1 className={authStyles.title}>Page not found</h1>
        <p className={authStyles.sub}>The page you were looking for doesn&apos;t exist or has moved.</p>
        <div className={styles.actions}>
          <Link to="/" className={styles.link}>Go to home page</Link>
          {token
            ? <Link to="/dashboard" className={styles.link}>Open dashboard</Link>
            : <Link to="/login" className={styles.link}>Sign in</Link>}
        </div>
      </div>
    </main>
  );
}
