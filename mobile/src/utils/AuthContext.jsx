import { createContext, useContext, useEffect, useState } from 'react';
import { getToken, saveToken, clearToken } from './storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,   setToken]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getToken().then(t => {
      setToken(t ?? null);
      setLoading(false);
    });
  }, []);

  async function signIn(newToken) {
    await saveToken(newToken);
    setToken(newToken);
  }

  async function signOut() {
    await clearToken();
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
