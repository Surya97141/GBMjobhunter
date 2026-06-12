import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV_ITEMS = [
  { to: '/dashboard',               label: 'Dashboard',    end: true  },
  { to: '/dashboard/applications',  label: 'Applications', end: false },
  { to: '/dashboard/insights',      label: 'Insights',     end: false },
  { to: '/dashboard/opportunities', label: 'Opportunities',end: false },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>

      <div className={styles.logo}>
        <span className={styles.logoMark}>GBM</span>
      </div>

      <nav className={styles.nav} aria-label="Main navigation">
        {NAV_ITEMS.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Hardcoded for now — wired to auth context in Phase 10 */}
      <div className={styles.userInfo}>
        <span className={styles.userName}>Alex Johnson</span>
        <span className={styles.userEmail}>alex@example.com</span>
      </div>

    </aside>
  );
}
