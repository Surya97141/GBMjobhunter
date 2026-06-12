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

module.exports = { standardLimiter, resumeUploadLimiter };
