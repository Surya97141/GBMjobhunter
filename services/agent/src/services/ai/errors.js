// Fixed AI error categories. Messages are written here, never copied from a
// provider response, so a key echoed in a provider error can't leak to the
// client or the logs.

const MESSAGES = {
  not_configured:       'The shared demo AI is not set up on this server. Add your own API key to use AI features.',
  quota_exceeded:       'You have used all of today\'s shared demo AI requests. Try again tomorrow, or use your own API key.',
  demo_capacity:        'The shared demo AI has reached today\'s limit for everyone. Try again tomorrow, or use your own API key.',
  quota_unavailable:    'The shared demo AI is temporarily unavailable. Try again later, or use your own API key.',
  provider_disabled:    'This AI provider is not available on this server. Choose another provider.',
  invalid_key:         'The API key was rejected by the provider. Check that it is correct and active.',
  permission_denied:    'This API key does not have access to the model used here.',
  rate_limited:         'The provider is rate-limiting this key. Wait a moment and try again.',
  timeout:              'The provider took too long to respond. Try again.',
  provider_unavailable: 'The provider could not be reached. Try again in a moment.',
  provider_error:       'The provider could not complete this request.',
  refused:              'The model declined this request.',
  bad_output:           'The AI response could not be used. Try again.',
  followup_limit:       'You have asked the maximum number of follow-up questions for this hour. Try again later.',
};

class AiError extends Error {
  constructor(code, status) {
    super(MESSAGES[code] ?? MESSAGES.provider_error);
    this.name   = 'AiError';
    this.code   = MESSAGES[code] ? code : 'provider_error';
    this.status = status ?? null; // provider HTTP status, safe to log
  }
}

function failure(code) {
  const err = code instanceof AiError ? code : new AiError(code);
  return { success: false, error: err.code, message: err.message };
}

module.exports = { AiError, failure, MESSAGES };
