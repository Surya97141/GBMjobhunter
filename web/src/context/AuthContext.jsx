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

  // If the GBM extension is installed it injects a content script into this
  // page.  Posting GBM_SET_TOKEN lets that script relay the JWT to the
  // extension's background worker, which stores it in chrome.storage.local.
  // Safe to call unconditionally — window.postMessage is a no-op if nothing
  // is listening.
  function notifyExtension(token) {
    try {
      window.postMessage({ type: 'GBM_SET_TOKEN', token }, window.location.origin);
    } catch {
      // Extension not installed or postMessage blocked — ignore.
    }
  }

  async function login(email, password) {
    const res = await client.post('/auth/login', { email, password });
    const { user: u, token: t } = res.data.data;
    _save(t, u);
    notifyExtension(t);
    return u;
  }

  async function register(email, password) {
    const res = await client.post('/auth/register', { email, password });
    const { user: u, token: t } = res.data.data;
    _save(t, u);
    notifyExtension(t);
    return u;
  }

  // Starts a throwaway demo session: the server creates a fresh account
  // pre-loaded with sample data, so there are no credentials to enter.
  // The extension relay is skipped on purpose: a demo token should not
  // replace a real session stored in someone's installed extension.
  async function startDemo() {
    const res = await client.post('/auth/demo');
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
    <AuthContext.Provider value={{ user, token, loading, login, register, startDemo, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
