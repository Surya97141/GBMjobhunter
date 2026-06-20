// Phase D verification seed — run from services/intelligence/ (has pg + uuid)
// Seeds TypeScript (positive lift) and Python (negative lift) test data.
//
// TypeScript: 8 users with ['javascript','typescript'], 2 apps each = 16 apps
//   → 6 users × 2 interview + 2 users × 2 rejected = 12/16 = 0.75 success rate
// Python:     5 users with ['python'], 3 apps each = 15 apps
//   → all 15 rejected = 0/15 = 0.0 success rate
//
// Baseline after seed: total_resolved = 3 (existing) + 16 + 15 = 34
//   total_success = 0 + 12 + 0 = 12
//   baseline_success_rate = 12/34 ≈ 0.3529
//
// Expected liftScores:
//   typescript: 0.75 - 0.3529 = 0.3971
//   python:     0.00 - 0.3529 = -0.3529

require('dotenv').config();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Single company for all seed applications
    const companyId = uuidv4();
    await client.query(
      `INSERT INTO companies (id, name) VALUES ($1, $2)`,
      [companyId, 'Phase D Test Co']
    );

    // ── TypeScript users (positive lift) ─────────────────────────────────────
    const tsOutcomes = [
      'interview','interview','interview','interview','interview','interview', // 6 × 2 = 12 interview
      'rejected','rejected',                                                   // 2 × 2 = 4  rejected
    ];

    for (let i = 0; i < 8; i++) {
      const uid = uuidv4();
      await client.query(
        `INSERT INTO users (id, email, hashed_password, resume_json)
         VALUES ($1, $2, $3, $4)`,
        [uid, `ts_user_${i + 1}@phased.test`, 'seed_hash',
         JSON.stringify({ skills: ['javascript', 'typescript'] })]
      );
      // 2 apps per user
      for (let j = 0; j < 2; j++) {
        await client.query(
          `INSERT INTO applications
             (id, user_id, company_id, role_title, jd_fingerprint_hash, ats_score_at_apply, outcome, applied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '30 days')`,
          [uuidv4(), uid, companyId, 'Software Engineer',
           uuidv4().replace(/-/g,'').slice(0,16), 70, tsOutcomes[i]]
        );
      }
    }

    // ── Python users (negative lift) ─────────────────────────────────────────
    for (let i = 0; i < 5; i++) {
      const uid = uuidv4();
      await client.query(
        `INSERT INTO users (id, email, hashed_password, resume_json)
         VALUES ($1, $2, $3, $4)`,
        [uid, `py_user_${i + 1}@phased.test`, 'seed_hash',
         JSON.stringify({ skills: ['python'] })]
      );
      // 3 apps per user, all rejected
      for (let j = 0; j < 3; j++) {
        await client.query(
          `INSERT INTO applications
             (id, user_id, company_id, role_title, jd_fingerprint_hash, ats_score_at_apply, outcome, applied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '30 days')`,
          [uuidv4(), uid, companyId, 'Data Analyst',
           uuidv4().replace(/-/g,'').slice(0,16), 45, 'rejected']
        );
      }
    }

    await client.query('COMMIT');
    console.log('[Seed] Committed successfully');

    // ── Verify counts ─────────────────────────────────────────────────────────
    const { rows } = await client.query(
      `SELECT
         COUNT(*)                                                  AS total_resolved,
         COUNT(*) FILTER (WHERE outcome IN ('interview','offer')) AS total_success
       FROM applications WHERE outcome <> 'pending'`
    );
    console.log('[Seed] total_resolved:', rows[0].total_resolved,
                '| total_success:', rows[0].total_success);
    console.log('[Seed] Expected: total_resolved=34, total_success=12');

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('[Seed] FAILED:', e.message); process.exit(1); });
