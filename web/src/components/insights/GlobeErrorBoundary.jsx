import { Component } from 'react';
import { isChunkLoadError } from '../../utils/chunkReload';

// Keeps a globe failure (WebGL context, three.js render error, or the lazy
// chunk failing to download) inside the map area instead of replacing the
// whole app with the global error page. The error is logged, not swallowed,
// and `onError` receives the reason so the caller can show a fallback.
export default class GlobeErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { reason: null };
  }

  static getDerivedStateFromError(error) {
    return { reason: isChunkLoadError(error) ? 'chunk' : 'render' };
  }

  componentDidCatch(error, info) {
    console.error('[insights] globe failed:', error, info?.componentStack ?? '');
    this.props.onError?.(this.state.reason ?? 'render', error);
  }

  render() {
    if (this.state.reason) return this.props.fallback?.(this.state.reason) ?? null;
    return this.props.children;
  }
}
