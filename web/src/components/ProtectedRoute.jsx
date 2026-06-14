import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Renders children only when the user is logged in.
// Shows nothing while the session is being restored from localStorage.
// Redirects to /login otherwise.
export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (!token)  return <Navigate to="/login" replace />;
  return children;
}
