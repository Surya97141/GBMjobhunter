const { createClient } = require('redis');

const client = createClient({ url: process.env.REDIS_URL });

client.on('error', (err) => {
  console.error('[Agent] Redis client error:', err.message);
});

client.connect().then(() => {
  console.log('[Agent] Connected to Redis');
});

module.exports = client;
