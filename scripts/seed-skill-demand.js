/**
 * Seed the skill_demand table with representative data for the current week.
 *
 * Run: node scripts/seed-skill-demand.js
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING on (skill, region, week).
 * The week column uses Monday-normalised ISO date (Sunday also maps to that Monday).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Data to seed ─────────────────────────────────────────────────────────────

const SKILLS = [
  'typescript',
  'react',
  'node.js',
  'postgresql',
  'python',
  'kubernetes',
  'rust',
  'go',
];

// region → { open_roles, applicant_pool } base values for that market size
const REGIONS = [
  { name: 'San Francisco', roles: 1800, pool: 4200 },
  { name: 'New York',      roles: 1400, pool: 3800 },
  { name: 'London',        roles: 1100, pool: 3100 },
  { name: 'Berlin',        roles:  700, pool: 2200 },
  { name: 'Singapore',     roles:  600, pool: 1900 },
  { name: 'Bangalore',     roles: 1600, pool: 5500 },
  { name: 'Toronto',       roles:  550, pool: 1700 },
  { name: 'Sydney',        roles:  400, pool: 1300 },
  { name: 'Amsterdam',     roles:  380, pool: 1200 },
  { name: 'Dubai',         roles:  290, pool:  980 },
];

// Skill-level modifiers — how sought-after each skill is relative to the base
const SKILL_DEMAND_MULTIPLIER = {
  'typescript':  1.30,
  'react':       1.25,
  'python':      1.40,
  'node.js':     1.10,
  'postgresql':  0.90,
  'kubernetes':  1.20,
  'rust':        0.80,
  'go':          1.05,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart() {
  const d = new Date();
  // Normalise to Monday of the current week
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function jitter(base, pct = 0.15) {
  // ±pct random variation so rows don't all look like round numbers
  return Math.round(base * (1 + (Math.random() * 2 - 1) * pct));
}

function heatScore(openRoles, applicantPool) {
  // heat = open_roles / applicant_pool × 100 (higher = more demand vs supply)
  if (applicantPool === 0) return 0;
  return Math.min(Math.round((openRoles / applicantPool) * 100 * 10) / 10, 100);
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const week = getWeekStart();
  console.log(`Seeding skill_demand for week ${week}…`);

  const client = await pool.connect();
  try {
    // Add unique constraint if it doesn't exist so ON CONFLICT works
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'skill_demand_skill_region_week_uq'
        ) THEN
          ALTER TABLE skill_demand
            ADD CONSTRAINT skill_demand_skill_region_week_uq
            UNIQUE (skill, region, week);
        END IF;
      END
      $$;
    `);

    let inserted = 0;
    let skipped  = 0;

    for (const skill of SKILLS) {
      const mult = SKILL_DEMAND_MULTIPLIER[skill] ?? 1.0;
      for (const region of REGIONS) {
        const openRoles    = jitter(Math.round(region.roles * mult));
        const applicantPool = jitter(region.pool);
        const heat          = heatScore(openRoles, applicantPool);

        const result = await client.query(
          `INSERT INTO skill_demand (skill, region, open_roles, applicant_pool, heat_score, week)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ON CONSTRAINT skill_demand_skill_region_week_uq DO NOTHING
           RETURNING id`,
          [skill, region.name, openRoles, applicantPool, heat, week]
        );

        if (result.rowCount > 0) {
          inserted++;
          console.log(`  + ${skill.padEnd(12)} ${region.name.padEnd(16)} roles=${openRoles} pool=${applicantPool} heat=${heat}`);
        } else {
          skipped++;
          console.log(`  ~ ${skill.padEnd(12)} ${region.name.padEnd(16)} already exists — skipped`);
        }
      }
    }

    console.log(`\nDone. Inserted: ${inserted}  Skipped: ${skipped}`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
