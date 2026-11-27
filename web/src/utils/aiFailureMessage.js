// Messages for failed AI requests. Server messages for these codes are fixed
// strings written by the backend (never provider text), so they are safe to show.
export function aiFailureMessage(err) {
  const status = err?.response?.status;
  if (status === 429) return err.response.data?.message || 'Too many AI requests. Wait a minute and try again.';
  if (status === 400 && err.response.data?.error === 'provider_disabled') return err.response.data.message;
  if (status === 400 && typeof err.response.data?.message === 'string') return err.response.data.message;
  if (err?.code === 'ECONNABORTED') return 'The AI request took too long. Try again.';
  return 'Could not reach the AI service. Try again in a moment.';
}
