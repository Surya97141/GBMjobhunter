// Daily limits for the shared demo key (GROQ_API_KEY). Two counters protect it:
// one per user, and one across all users so the key's own quota can't be
// drained by many accounts. Counters expire at midnight UTC.
//
// BYOK requests are not counted here: they spend the user's own provider quota
// and are covered by the gateway's per-user AI rate limit.

// Loaded on first use: the Redis client connects as soon as it is required,
// and only demo-mode requests need it.
let redisClient = null;
function redis() {
  if (!redisClient) redisClient = require('../../utils/redis');
  return redisClient;
}

const perUserLimit = () => Number(process.env.AI_DEMO_DAILY_LIMIT_PER_USER) || 20;
const totalLimit   = () => Number(process.env.AI_DEMO_DAILY_LIMIT_TOTAL)    || 500;

function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((midnight - now.getTime()) / 1000);
}

async function bump(key) {
  const count = await redis().incr(key);
  if (count === 1) await redis().expire(key, secondsUntilMidnightUTC());
  return count;
}

// Returns null when allowed, or an error code. Throws if Redis is unreachable;
// the caller fails closed (the shared key is not used without a working limit).
async function consumeDemoQuota(userId) {
  const day = todayUTC();
  const userCount = await bump(`ai_demo:user:${userId}:${day}`);
  if (userCount > perUserLimit()) return 'quota_exceeded';
  const totalCount = await bump(`ai_demo:total:${day}`);
  if (totalCount > totalLimit()) return 'demo_capacity';
  return null;
}

module.exports = { consumeDemoQuota, perUserLimit, totalLimit };
