import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import styles from './DashboardLayout.module.css';

// Layout route — renders once when entering /dashboard and stays mounted
// while navigating between sub-routes. <Outlet> renders the active child page.
// This keeps the Sidebar alive across /dashboard, /dashboard/applications, etc.
export default function DashboardLayout() {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <Outlet />
    </div>
  );
}
