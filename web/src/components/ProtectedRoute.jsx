import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RouteFallback from './RouteFallback';

// Renders children only when the user is logged in.
// Shows a loading state while the stored session is verified with the API
// (this can take several seconds when the backend is waking from sleep).
// Redirects to /login otherwise.
export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <RouteFallback fullPage label="Restoring your session…" />;
  if (!token)  return <Navigate to="/login" replace />;
  return children;
}
