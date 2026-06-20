// ─── Model Tier Router ────────────────────────────────────────────────────────
//
// Single entry point for all model calls across the GBM platform.
// Exposes: callModel(tier, task, payload) → { success, data } | { success, error, message }
//
// Tier 1  — intentionally NOT routable here. These tasks run client-side or
//           via direct DB query. Routing them through callModel is always a
//           mistake; the function throws to catch it early.
//
// Tier 2  — small open-source model via any OpenAI-compatible endpoint
//           (Groq, Together AI, Fireworks, Ollama, etc.)
//
// Tier 3  — Anthropic frontier model (Claude) via the official SDK.

const Anthropic = require('@anthropic-ai/sdk');
const { checkTier3Quota, QUOTA_PER_DAY } = require('./rateLimiter.service');

const DEFAULT_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS) || 10_000;

const GENERIC_SYSTEM_PROMPT =
  'You are an expert assistant embedded in a job search intelligence platform. ' +
  'Respond concisely, accurately, and in plain JSON when a structured output is requested.';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function logUsage(tier, task, usage) {
  const input  = usage?.input_tokens  ?? usage?.prompt_tokens     ?? '?';
  const output = usage?.output_tokens ?? usage?.completion_tokens ?? '?';
  console.log(
    `[ModelRouter] tier=${tier} task=${task} ` +
    `input_tokens=${input} output_tokens=${output} ` +
    `ts=${new Date().toISOString()}`
  );
}

function notConfigured(tier, missing) {
  const label = tier.replace('tier', '');
  return {
    success: false,
    error:   'not_configured',
    message: `Tier ${label} is not configured. Set the following env vars in services/agent/.env: ${missing.join(', ')}`,
  };
}

function buildMessages(payload) {
  // If the caller provides explicit messages array, use it directly.
  // Otherwise treat the whole payload as the user turn content.
  return payload.messages ?? [{ role: 'user', content: JSON.stringify(payload) }];
}

// ─── Tier 2 — OpenAI-compatible endpoint ─────────────────────────────────────

async function callTier2(task, payload) {
  const apiBase = process.env.TIER2_API_BASE;
  const apiKey  = process.env.TIER2_API_KEY;
  const model   = process.env.TIER2_MODEL_NAME;

  const missing = [
    !apiBase && 'TIER2_API_BASE',
    !apiKey  && 'TIER2_API_KEY',
    !model   && 'TIER2_MODEL_NAME',
  ].filter(Boolean);
  if (missing.length) return notConfigured('tier2', missing);

  const systemPrompt = payload.systemPrompt ?? GENERIC_SYSTEM_PROMPT;
  const messages     = buildMessages(payload);
  const temperature  = payload.temperature  ?? 0.3;
  const maxTokens    = payload.maxTokens    ?? 1024;

  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature,
    max_tokens: maxTokens,
    ...(payload.responseFormat && { response_format: payload.responseFormat }),
  });

  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const json = await res.json();

    if (!res.ok) {
      console.error(`[ModelRouter] tier2 task=${task} HTTP ${res.status}:`, json);
      return {
        success: false,
        error:   'provider_error',
        message: json.error?.message ?? `Provider returned HTTP ${res.status}`,
      };
    }

    logUsage('tier2', task, json.usage);
    return { success: true, data: json };

  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(
      `[ModelRouter] tier2 task=${task} ${isTimeout ? 'timeout' : 'network_error'}:`,
      err.message
    );
    return {
      success: false,
      error:   isTimeout ? 'timeout' : 'network_error',
      message: isTimeout
        ? `Tier 2 call timed out after ${DEFAULT_TIMEOUT_MS}ms (task: ${task})`
        : err.message,
    };
  }
}

// ─── Tier 3 — Anthropic ───────────────────────────────────────────────────────

async function callTier3(task, payload) {
  // Quota check first — cheap Redis lookup, avoids touching paid API unnecessarily.
  // In production TIER3_API_KEY is always set, so the not_configured path below
  // never occurs; but even in misconfigured environments, quota is correctly tracked.
  if (payload.userId) {
    const quota = await checkTier3Quota(payload.userId);
    if (!quota.allowed) {
      return {
        success: false,
        error:   'quota_exceeded',
        message: `Daily Tier 3 quota of ${QUOTA_PER_DAY} calls reached for this user. Resets at midnight UTC.`,
      };
    }
  }

  const apiKey = process.env.TIER3_API_KEY;
  const model  = process.env.TIER3_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) return notConfigured('tier3', ['TIER3_API_KEY']);

  const systemPrompt = payload.systemPrompt ?? GENERIC_SYSTEM_PROMPT;
  const messages     = buildMessages(payload);
  const maxTokens    = payload.maxTokens    ?? 1024;

  try {
    const client   = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages,
    });

    logUsage('tier3', task, response.usage);
    return { success: true, data: response };

  } catch (err) {
    // Anthropic SDK throws APIConnectionTimeoutError on deadline breach;
    // its message reliably contains "timeout".
    const isTimeout =
      err.name === 'APIConnectionTimeoutError' ||
      err.message?.toLowerCase().includes('timeout');

    console.error(
      `[ModelRouter] tier3 task=${task} ${isTimeout ? 'timeout' : 'provider_error'}:`,
      err.message
    );
    return {
      success: false,
      error:   isTimeout ? 'timeout' : 'provider_error',
      message: isTimeout
        ? `Tier 3 call timed out after ${DEFAULT_TIMEOUT_MS}ms (task: ${task})`
        : err.message,
    };
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

async function callModel(tier, task, payload = {}) {
  if (tier === 'tier1') {
    // Tier 1 tasks (client-side classifier, cohort DB ranker) have no external
    // call to make — routing them here is always a caller mistake.
    throw new Error(
      `Tier 1 tasks run client-side or via direct DB query — ` +
      `do not route through callModel. See the "${task}" implementation directly.`
    );
  }

  if (tier === 'tier2') return callTier2(task, payload);
  if (tier === 'tier3') return callTier3(task, payload);

  throw new Error(
    `Unknown tier: "${tier}". Valid values are 'tier1', 'tier2', or 'tier3'.`
  );
}

module.exports = { callModel };
