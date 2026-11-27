import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { buildAiPayload, isSecureApiBase } from '../utils/aiTransport';

// AI mode selection for the dashboard: the shared demo key (server side) or
// the user's own provider key.
//
// The user's key lives ONLY in this React state. It is never written to
// localStorage, sessionStorage, cookies or the URL. The provider is mounted
// inside the dashboard layout, so the key is gone after a reload, a sign-out
// or leaving the dashboard.

const AiSettingsContext = createContext(null);

// Used until /agent/ai/status answers (or if it fails). Anthropic is not
// listed: the server enables it only when configured, and says so in the status.
const DEFAULT_PROVIDERS = [
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
];

export function AiSettingsProvider({ children }) {
  const [status,   setStatus]   = useState(null);     // GET /agent/ai/status data
  const [statusState, setStatusState] = useState('loading'); // loading | ready | error
  const [mode,     setMode]     = useState('demo');   // 'demo' | 'byok'
  const [chosenProvider, setProvider] = useState('groq');
  const [apiKey,   setApiKey]   = useState('');

  useEffect(() => {
    let cancelled = false;
    client.get('/agent/ai/status')
      .then(res => {
        if (cancelled) return;
        const data = res.data?.data ?? null;
        setStatus(data);
        setStatusState('ready');
        if (!data?.demo?.available) setMode('byok');
      })
      .catch(() => {
        if (cancelled) return;
        setStatusState('error');
        setMode('byok');
      });
    return () => { cancelled = true; };
  }, []);

  const secureTransport = isSecureApiBase(client.defaults.baseURL);
  const demoAvailable   = Boolean(status?.demo?.available);
  const providers       = status?.byok?.providers ?? DEFAULT_PROVIDERS;

  // The selection, kept on a provider this server offers.
  const provider = providers.some(p => p.id === chosenProvider) ? chosenProvider : (providers[0]?.id ?? chosenProvider);

  const value = useMemo(() => {
    const selected = mode === 'demo'
      ? { label: status?.demo?.label ?? 'Groq', model: status?.demo?.model ?? null }
      : { label: providers.find(p => p.id === provider)?.label ?? provider,
          model: providers.find(p => p.id === provider)?.model ?? null };
    return {
      status, statusState, demoAvailable, providers, secureTransport,
      mode, setMode, provider, setProvider, apiKey, setApiKey,
      clearKey: () => setApiKey(''),
      selected,
      // The `ai` block for a request, or null when no request can be made.
      aiPayload: buildAiPayload({
        mode, provider, apiKey, demoAvailable, secureTransport,
        allowedProviders: providers.map(p => p.id),
      }),
    };
  }, [status, statusState, demoAvailable, providers, secureTransport, mode, provider, apiKey]);

  return <AiSettingsContext.Provider value={value}>{children}</AiSettingsContext.Provider>;
}

export function useAiSettings() {
  const ctx = useContext(AiSettingsContext);
  if (!ctx) throw new Error('useAiSettings must be used inside <AiSettingsProvider>');
  return ctx;
}
