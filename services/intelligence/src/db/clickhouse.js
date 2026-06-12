const { createClient } = require('@clickhouse/client');

const client = createClient({
  url:      process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  database: 'default',
});

async function ping() {
  await client.ping();
}

module.exports = { client, ping };
