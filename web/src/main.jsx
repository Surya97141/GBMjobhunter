import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import ErrorBoundary from './ErrorBoundary';
import { installChunkReloadHandler } from './utils/chunkReload';

import './styles/themes.css';
import './styles/typography.css';
import './styles/global.css';
import './App.css';

import App from './App';

// Reload once if a lazy route chunk fails to load (e.g. a tab left open across a
// redeploy). Must be installed before any lazy route is imported.
installChunkReloadHandler();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
