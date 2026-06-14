import { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY   = 'gbm_token';

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  // On first load, if a token is stored, verify it by fetching the user profile.
  // If the token is expired or invalid the request returns 401 and we clear it.
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    client.get('/users/me')
      .then(res => setUser(res.data.data.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function _save(newToken, newUser) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }

  async function login(email, password) {
    const res = await client.post('/auth/login', { email, password });
    const { user: u, token: t } = res.data.data;
    _save(t, u);
    return u;
  }

  async function register(email, password) {
    const res = await client.post('/auth/register', { email, password });
    const { user: u, token: t } = res.data.data;
    _save(t, u);
    return u;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
