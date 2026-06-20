import { NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import styles from './Sidebar.module.css';

const NAV_ITEMS = [
  { to: '/dashboard',               label: 'Dashboard',     end: true  },
  { to: '/dashboard/tracker',        label: 'Tracker',       end: false },
  { to: '/dashboard/insights',      label: 'Insights',      end: false },
  { to: '/dashboard/profile',       label: 'Profile',       end: false },
  { to: '/dashboard/opportunities', label: 'Opportunities', end: false },
];

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {/* Crescent: a full disc with a smaller disc punched out via path */}
      <path
        d="M11.9 8.6A5.5 5.5 0 0 1 5.4 2.1a5.5 5.5 0 1 0 6.5 6.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <line x1="7"    y1="1"     x2="7"     y2="2.5"  />
        <line x1="7"    y1="11.5"  x2="7"     y2="13"   />
        <line x1="1"    y1="7"     x2="2.5"   y2="7"    />
        <line x1="11.5" y1="7"     x2="13"    y2="7"    />
        <line x1="2.93" y1="2.93"  x2="3.98"  y2="3.98" />
        <line x1="10.02"y1="10.02" x2="11.07" y2="11.07"/>
        <line x1="11.07"y1="2.93"  x2="10.02" y2="3.98" />
        <line x1="3.98" y1="10.02" x2="2.93"  y2="11.07"/>
      </g>
    </svg>
  );
}

export default function Sidebar() {
  const { theme, setTheme } = useTheme();
  const { user, logout }    = useAuth();
  const navigate            = useNavigate();
  const isDark              = theme === 'obsidian';

  function handleToggle() {
    setTheme(isDark ? 'cream' : 'obsidian');
  }

  function handleLogout() {
    logout();
    navigate('/');
  }

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

      {/* Theme toggle sits above the user info footer */}
      <button
        className={styles.themeToggle}
        onClick={handleToggle}
        aria-label={isDark ? 'Switch to cream theme' : 'Switch to obsidian theme'}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
        <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
      </button>

      <div className={styles.userInfo}>
        <span className={styles.userEmail}>{user?.email ?? '—'}</span>
        <button className={styles.logoutBtn} onClick={handleLogout}>Sign out</button>
      </div>

    </aside>
  );
}
