const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { issueToken } = require('./auth.service');
const {
  DEMO_PROFILE, DEMO_RESUME, DEMO_APPLICATIONS, DEMO_PATTERNS,
} = require('../demo/demoData');

// Demo accounts are throwaway. Anything older than this is deleted.
const DEMO_TTL_HOURS = 4;

// The demo endpoint must not exist on a real deployment. It is opt-in via env.
function isDemoEnabled() {
  return process.env.DEMO_MODE_ENABLED === 'true';
}

// Deletes expired demo users. applications and user_insights cascade from
// users, so their sample data goes with them. Runs before each new demo
// signup instead of on a timer: free-tier hosts sleep idle processes, and a
// setInterval would silently stop running. Cleanup happens whenever demo
// traffic actually exists, and the partial index keeps it cheap.
async function deleteExpiredDemoUsers(ttlHours = DEMO_TTL_HOURS) {
  const { rowCount } = await pool.query(
    `DELETE FROM users
     WHERE is_demo AND created_at < NOW() - make_interval(hours => $1)`,
    [ttlHours]
  );
  return rowCount;
}

// Companies have no per-user ownership and no cascade, so reuse by name
// instead of inserting new rows for every demo visitor.
async function findOrCreateCompany(client, name) {
  const found = await client.query('SELECT id FROM companies WHERE name = $1 LIMIT 1', [name]);
  if (found.rows[0]) return found.rows[0].id;
  const id = uuidv4();
  await client.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

async function seedUserData(client, userId) {
  for (const app of DEMO_APPLICATIONS) {
    const companyId = await findOrCreateCompany(client, app.company);
    await client.query(
      `INSERT INTO applications
         (id, user_id, company_id, role_title, ats_score_at_apply,
          outcome, response_days, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - make_interval(days => $8))`,
      [uuidv4(), userId, companyId, app.role, app.ats, app.outcome, app.responseDays, app.daysAgo]
    );
  }

  for (const p of DEMO_PATTERNS) {
    const { rows } = await client.query(
      `INSERT INTO cohort_patterns
         (id, role_bucket, skill_cluster, pattern_type, finding, cohort_size, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (role_bucket, skill_cluster, pattern_type)
       DO UPDATE SET finding = EXCLUDED.finding, cohort_size = EXCLUDED.cohort_size
       RETURNING id`,
      [uuidv4(), p.roleBucket, p.skillCluster, p.patternType, JSON.stringify(p.finding), p.cohortSize]
    );
    await client.query(
      `INSERT INTO user_insights (id, user_id, pattern_id, headline, action, source)
       VALUES ($1, $2, $3, $4, $5, 'demo')`,
      [uuidv4(), userId, rows[0].id, p.headline, p.action]
    );
  }
}

// Creates a fresh demo user with sample data and returns a session token.
// Everything runs in one transaction: a failure part-way leaves no half-seeded
// account behind.
async function createDemoSession() {
  await deleteExpiredDemoUsers();

  const userId = uuidv4();
  const email  = `demo-${userId}@demo.invalid`; // .invalid is a reserved, undeliverable TLD

  // Nobody ever logs into a demo account with a password. Hash random bytes
  // (cost 4, fast) so the column holds a valid hash that no input can match.
  const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 4);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users
         (id, email, hashed_password, name, target_role, target_location,
          years_of_experience, resume_json, ats_score_cache, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 72, TRUE)`,
      [
        userId, email, hashedPassword,
        DEMO_PROFILE.name, DEMO_PROFILE.target_role, DEMO_PROFILE.target_location,
        DEMO_PROFILE.years_of_experience, JSON.stringify(DEMO_RESUME),
      ]
    );
    await seedUserData(client, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    user:  { id: userId, email, name: DEMO_PROFILE.name, is_demo: true },
    token: issueToken(userId, email),
  };
}

module.exports = { isDemoEnabled, createDemoSession, deleteExpiredDemoUsers, DEMO_TTL_HOURS };
