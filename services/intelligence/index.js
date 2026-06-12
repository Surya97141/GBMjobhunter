require('dotenv').config();

if (!process.env.DATABASE_URL)   throw new Error('DATABASE_URL env var is required');
if (!process.env.REDIS_URL)      throw new Error('REDIS_URL env var is required');
if (!process.env.CLICKHOUSE_URL) throw new Error('CLICKHOUSE_URL env var is required');

const { ping }               = require('./src/db/clickhouse');
const { setupNightlySchedule } = require('./src/queues/scheduler');

require('./src/queues/consumers');

async function start() {
  await ping();
  console.log('Intelligence Service connected to ClickHouse');

  await setupNightlySchedule();

  console.log('Intelligence Service running — consuming events');
}

start().catch((err) => {
  console.error('Intelligence Service failed to start:', err.message);
  process.exit(1);
});
