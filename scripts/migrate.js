require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM migrations WHERE filename = $1',
        [file]
      );

      if (rowCount > 0) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO migrations (filename) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`  apply ${file}`);
    }

    console.log('Migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
