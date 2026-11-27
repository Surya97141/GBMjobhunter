import { Component } from 'react';
import { isChunkLoadError } from './utils/chunkReload';

// Technical details (message + stack) are only shown in development builds.
// Production users get a plain explanation and a way to recover.
const SHOW_DETAILS = import.meta.env.DEV;

// This boundary sits outside ThemeProvider, so every colour has a fallback in
// case the crash happened before a theme was applied to <html>.
const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'var(--bg-primary, #faf8f3)',
    color: 'var(--text-primary, #1a1814)',
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
  },
  box:     { maxWidth: 480 },
  title:   { fontSize: 22, fontWeight: 600, margin: '0 0 8px' },
  body:    { fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #6b6560)', margin: '0 0 20px' },
  actions: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  primary: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--text-primary, #1a1814)',
    color: 'var(--bg-primary, #faf8f3)',
    fontSize: 14,
    fontWeight: 500,
  },
  secondary: {
    padding: '10px 18px',
    borderRadius: 8,
    border: '1px solid var(--border-strong, rgba(0,0,0,0.18))',
    color: 'var(--text-primary, #1a1814)',
    fontSize: 14,
    fontWeight: 500,
  },
  details: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    background: '#1a0000',
    color: '#ff9b9b',
    fontFamily: 'monospace',
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
};

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the details available in the browser console for debugging.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      // A failed lazy-chunk load usually means the app was updated while this
      // tab was open, or the connection dropped while loading the page.
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <main style={s.page} role="alert">
          <div style={s.box}>
            <h1 style={s.title}>{chunkError ? 'This page could not be loaded' : 'Something went wrong'}</h1>
            <p style={s.body}>
              {chunkError
                ? 'Part of the app failed to download. This happens when GBMjobhunter was updated while this tab was open, or the connection dropped. Reload to get the latest version.'
                : 'This page hit an unexpected error. Reloading the page usually fixes it.'}
            </p>
            <div style={s.actions}>
              <button type="button" style={s.primary} onClick={() => window.location.reload()}>
                Reload page
              </button>
              <a href="/" style={s.secondary}>Go to home page</a>
            </div>
            {SHOW_DETAILS && (
              <pre style={s.details}>
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
