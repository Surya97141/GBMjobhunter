const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err.message);
  process.exit(1);
});

module.exports = pool;
