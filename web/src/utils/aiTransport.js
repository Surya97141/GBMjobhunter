// A user's own provider key may only travel over HTTPS. Plain HTTP is allowed
// for a backend on the same machine (local development) only.
export function isSecureApiBase(baseUrl) {
  if (typeof baseUrl !== 'string') return false;
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

// Every provider the client knows about. Which ones a server actually offers
// comes from /agent/ai/status (Anthropic is off unless the server enables it).
export const BYOK_PROVIDERS = ['groq', 'openai', 'anthropic'];

// The `ai` block sent with an AI request, or null when the current selection
// cannot make a request (demo unavailable, no key entered, insecure transport,
// or a provider this server does not offer).
export function buildAiPayload({
  mode, provider, apiKey, demoAvailable, secureTransport, allowedProviders = BYOK_PROVIDERS,
}) {
  if (mode === 'demo') return demoAvailable ? { mode: 'demo' } : null;
  if (mode !== 'byok' || !secureTransport) return null;
  if (!BYOK_PROVIDERS.includes(provider) || !allowedProviders.includes(provider)) return null;
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key.length < 20) return null;
  return { mode: 'byok', provider, apiKey: key };
}
