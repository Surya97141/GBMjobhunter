const redis = require('../utils/redis');

// Daily Tier 3 quota per user. Configurable via env; default is 5.
// Tier 1 and Tier 2 calls are not quota-gated here — they are cheap enough
// to be covered by the gateway's standard request rate limit alone.
const QUOTA_PER_DAY = Number(process.env.TIER3_QUOTA_PER_DAY) || 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayUTC() {
  // YYYY-MM-DD in UTC — changes at midnight UTC, which is when the quota resets.
  return new Date().toISOString().split('T')[0];
}

function secondsUntilMidnightUTC() {
  const now      = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1  // next calendar day at 00:00:00 UTC
  ));
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Check (and consume) one Tier 3 slot for the given user today.
 *
 * Atomically increments the counter. If this is the first call of the day
 * (count reaches 1), sets a TTL aligned to midnight UTC so Redis self-cleans.
 *
 * Returns:
 *   { allowed: true,  remainingToday: N }   — call permitted, N slots left
 *   { allowed: false, remainingToday: 0  }  — daily quota exhausted
 *
 * If Redis is unreachable this throws — callTier3 in modelRouter catches it
 * and returns a structured error rather than crashing.
 */
async function checkTier3Quota(userId) {
  const key   = `tier3_quota:${userId}:${todayUTC()}`;
  const count = await redis.incr(key);

  if (count === 1) {
    // First call of the day — set expiry so the key cleans itself up.
    await redis.expire(key, secondsUntilMidnightUTC());
  }

  if (count > QUOTA_PER_DAY) {
    return { allowed: false, remainingToday: 0 };
  }

  return { allowed: true, remainingToday: QUOTA_PER_DAY - count };
}

module.exports = { checkTier3Quota, QUOTA_PER_DAY };
