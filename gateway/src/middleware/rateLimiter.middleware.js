const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('../utils/redis');

function makeKeyGenerator(prefix) {
  return (req) => {
    const id = req.user?.sub || req.ip;
    return `${prefix}:${id}`;
  };
}

const standardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: makeKeyGenerator('rl:standard'),
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many requests. Limit: 100 per minute.',
    });
  },
});

const resumeUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: makeKeyGenerator('rl:resume'),
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many resume uploads. Limit: 10 per minute.',
    });
  },
});

// Each call creates a user plus sample rows in the database, so the public
// demo endpoint gets a much tighter, per-IP limit than ordinary routes.
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: makeKeyGenerator('rl:demo'),
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many demo sessions from this network. Try again in an hour.',
    });
  },
});

// AI routes call paid model providers (the shared demo key, or a user's own
// key relayed through this server), so they get a tighter per-user limit on
// top of the standard one. Daily demo-key quotas live in the agent service.
const AI_PER_MINUTE = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 10;
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AI_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: makeKeyGenerator('rl:ai'),
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'rate_limited',
      message: `Too many AI requests. Limit: ${AI_PER_MINUTE} per minute.`,
    });
  },
});

module.exports = { standardLimiter, resumeUploadLimiter, demoLimiter, aiLimiter };
