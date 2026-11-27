import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import DemoBanner from './DemoBanner';
import { AiSettingsProvider } from '../../context/AiSettingsContext';
import styles from './DashboardLayout.module.css';

// Layout route — renders once when entering /dashboard and stays mounted
// while navigating between sub-routes. <Outlet> renders the active child page.
// This keeps the Sidebar alive across /dashboard, /dashboard/applications, etc.
// DemoBanner renders nothing unless the signed-in account is a demo account.
export default function DashboardLayout() {
  // AiSettingsProvider holds the AI mode and any user-entered provider key in
  // memory for as long as the dashboard is mounted (cleared on sign-out/reload).
  return (
    <AiSettingsProvider>
      <DemoBanner />
      <div className={styles.layout}>
        <Sidebar />
        <Outlet />
      </div>
    </AiSettingsProvider>
  );
}
