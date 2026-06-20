import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/dashboard/DashboardLayout';

const LandingPage       = lazy(() => import('./pages/LandingPage'));
const LoginPage         = lazy(() => import('./pages/LoginPage'));
const RegisterPage      = lazy(() => import('./pages/RegisterPage'));
const DashboardPage     = lazy(() => import('./pages/DashboardPage'));
const KanbanPage        = lazy(() => import('./pages/KanbanPage'));
const InsightsPage      = lazy(() => import('./pages/InsightsPage'));
const ProfilePage       = lazy(() => import('./pages/ProfilePage'));
const OpportunitiesPage = lazy(() => import('./pages/OpportunitiesPage'));

function AnimatedRoutes() {
  const location   = useLocation();
  const topSegment = location.pathname;

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={topSegment}>

        <Route path="/" element={
          <PageTransition>
            <Suspense fallback={null}><LandingPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/login" element={
          <PageTransition>
            <Suspense fallback={null}><LoginPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/register" element={
          <PageTransition>
            <Suspense fallback={null}><RegisterPage /></Suspense>
          </PageTransition>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute>
            <PageTransition>
              <Suspense fallback={null}><DashboardLayout /></Suspense>
            </PageTransition>
          </ProtectedRoute>
        }>
          <Route index element={<Suspense fallback={null}><DashboardPage /></Suspense>} />
          <Route path="tracker" element={<Suspense fallback={null}><KanbanPage /></Suspense>} />
          <Route path="insights" element={<Suspense fallback={null}><InsightsPage /></Suspense>} />
          <Route path="profile"       element={<Suspense fallback={null}><ProfilePage /></Suspense>} />
          <Route path="opportunities" element={<Suspense fallback={null}><OpportunitiesPage /></Suspense>} />
        </Route>

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
