import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'platform-theme';
const VALID_THEMES = ['obsidian', 'cream'];

function getInitialTheme() {
  if (typeof window !== 'undefined' && window.chrome?.extension) {
    return 'extension';
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (VALID_THEMES.includes(stored)) return stored;
  return 'cream';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme !== 'extension') {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  function setTheme(next) {
    if (window.chrome?.extension) return;
    if (!VALID_THEMES.includes(next)) return;
    setThemeState(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
