require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@clickhouse/client');

const client = createClient({
  url:      process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  database: 'default',
});

async function setup() {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS application_events (
        application_id       String,
        anonymised_cohort_id String,
        role_bucket          String,
        skill_cluster        String,
        ats_score            Nullable(Int32),
        company_size_band    Nullable(Int32),
        ats_platform         String,
        outcome              String DEFAULT 'pending',
        response_days        Nullable(Int32),
        applied_at           DateTime
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY application_id
    `,
  });

  console.log('ClickHouse table application_events ready.');
  await client.close();
}

setup().catch((err) => {
  console.error('ClickHouse setup failed:', err.message);
  process.exit(1);
});
