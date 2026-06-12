const { createClient } = require('redis');

const client = createClient({ url: process.env.REDIS_URL });

client.on('error', (err) => {
  console.error('Redis client error:', err.message);
});

client.connect().then(() => {
  console.log('Gateway connected to Redis');
});

module.exports = client;
