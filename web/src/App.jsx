import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import PageTransition from './components/PageTransition';
import DashboardLayout from './components/dashboard/DashboardLayout';

const LandingPage   = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const KanbanPage    = lazy(() => import('./pages/KanbanPage'));

function AnimatedRoutes() {
  const location = useLocation();

  // Only the top-level segment drives AnimatePresence so the sidebar
  // stays mounted when navigating within /dashboard/* sub-routes.
  const topSegment = '/' + location.pathname.split('/')[1];

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={topSegment}>

        <Route
          path="/"
          element={
            <PageTransition>
              <Suspense fallback={null}>
                <LandingPage />
              </Suspense>
            </PageTransition>
          }
        />

        {/* Layout route — DashboardLayout renders once, Outlet swaps child */}
        <Route
          path="/dashboard"
          element={
            <PageTransition>
              <Suspense fallback={null}>
                <DashboardLayout />
              </Suspense>
            </PageTransition>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route
            path="applications"
            element={
              <Suspense fallback={null}>
                <KanbanPage />
              </Suspense>
            }
          />
        </Route>

      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
