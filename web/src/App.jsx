import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';
import RouteFallback from './components/RouteFallback';
import DashboardLayout from './components/dashboard/DashboardLayout';

const LandingPage       = lazy(() => import('./pages/LandingPage'));
const LoginPage         = lazy(() => import('./pages/LoginPage'));
const RegisterPage      = lazy(() => import('./pages/RegisterPage'));
const DashboardPage     = lazy(() => import('./pages/DashboardPage'));
const KanbanPage        = lazy(() => import('./pages/KanbanPage'));
const InsightsPage      = lazy(() => import('./pages/InsightsPage'));
const ProfilePage       = lazy(() => import('./pages/ProfilePage'));
const OpportunitiesPage = lazy(() => import('./pages/OpportunitiesPage'));
const NotFoundPage      = lazy(() => import('./pages/NotFoundPage'));

// Fallbacks: full-viewport for top-level routes, content-area for pages
// rendered beside the dashboard sidebar.
const pageFallback  = <RouteFallback fullPage />;
const innerFallback = <RouteFallback />;

function AnimatedRoutes() {
  const location   = useLocation();
  const topSegment = location.pathname;

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={topSegment}>

        <Route path="/" element={
          <PageTransition>
            <Suspense fallback={pageFallback}><LandingPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/login" element={
          <PageTransition>
            <Suspense fallback={pageFallback}><LoginPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/register" element={
          <PageTransition>
            <Suspense fallback={pageFallback}><RegisterPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute>
            <PageTransition>
              <Suspense fallback={pageFallback}><DashboardLayout /></Suspense>
            </PageTransition>
          </ProtectedRoute>
        }>
          <Route index element={<Suspense fallback={innerFallback}><DashboardPage /></Suspense>} />
          <Route path="tracker" element={<Suspense fallback={innerFallback}><KanbanPage /></Suspense>} />
          <Route path="insights" element={<Suspense fallback={innerFallback}><InsightsPage /></Suspense>} />
          <Route path="profile"       element={<Suspense fallback={innerFallback}><ProfilePage /></Suspense>} />
          <Route path="opportunities" element={<Suspense fallback={innerFallback}><OpportunitiesPage /></Suspense>} />
          <Route path="*" element={<Suspense fallback={innerFallback}><NotFoundPage inApp /></Suspense>} />
        </Route>

        <Route path="*" element={
          <PageTransition>
            <Suspense fallback={pageFallback}><NotFoundPage /></Suspense>
          </PageTransition>
        } />

      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AnimatedRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
