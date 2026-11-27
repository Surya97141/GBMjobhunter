import styles from './RouteFallback.module.css';

// Shown while a lazy route chunk loads or the session is being restored.
// `fullPage` fills the viewport (top-level routes); otherwise it fills the
// dashboard content area next to the sidebar. The text fades in after a short
// delay so fast loads don't flash it.
export default function RouteFallback({ fullPage = false, label = 'Loading…' }) {
  return (
    <div
      className={`${styles.fallback} ${fullPage ? styles.fullPage : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.text}>{label}</span>
    </div>
  );
}
