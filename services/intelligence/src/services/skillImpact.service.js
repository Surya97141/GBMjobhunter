/*
 * APPROXIMATION: uses current resume skills, not a point-in-time snapshot
 * at application date. Acceptable for v1 since skills change infrequently
 * relative to application velocity. Future improvement: add a skills snapshot
 * column to applications at log time.
 *
 * FUTURE PHASE: once per-skill cohort sizes reach ~500 resolved applications,
 * consider replacing this lift-score with a trained gradient-boosted model.
 * Until then the explicit lift formula is more honest than a model trained on
 * sparse data.
 */

const pool       = require('../db/pool');
const insightsDb = require('../db/insights.db');

const MIN_SKILL_SAMPLE = 15;

async function computeSkillImpactPatterns() {
  console.log('[SkillImpact] Starting skill impact computation');

  const { rows } = await pool.query(
    `WITH baseline AS (
       SELECT
         COUNT(*)                                                  AS total_count,
         COUNT(*) FILTER (WHERE outcome IN ('interview', 'offer')) AS success_count
       FROM applications
       WHERE outcome <> 'pending'
     ),
     skill_stats AS (
       SELECT
         LOWER(skill.value)                                                   AS skill_name,
         COUNT(*)                                                             AS sample_size,
         COUNT(*) FILTER (WHERE a.outcome IN ('interview', 'offer'))          AS success_count
       FROM users u
       CROSS JOIN LATERAL jsonb_array_elements_text(u.resume_json->'skills') AS skill(value)
       JOIN applications a ON a.user_id = u.id
       WHERE a.outcome <> 'pending'
         AND u.resume_json ? 'skills'
       GROUP BY LOWER(skill.value)
       HAVING COUNT(*) >= $1
     )
     SELECT
       ss.skill_name,
       ss.sample_size::int                                                      AS sample_size,
       (ss.success_count::float / ss.sample_size)                              AS skill_success_rate,
       (b.success_count::float / NULLIF(b.total_count, 0))                     AS baseline_success_rate
     FROM skill_stats ss, baseline b`,
    [MIN_SKILL_SAMPLE]
  );

  console.log(`[SkillImpact] ${rows.length} skills with >= ${MIN_SKILL_SAMPLE} resolved applications`);

  const patternIds = [];

  for (const row of rows) {
    const skillSuccessRate    = parseFloat(row.skill_success_rate);
    const baselineSuccessRate = parseFloat(row.baseline_success_rate ?? 0);
    const liftScore           = skillSuccessRate - baselineSuccessRate;

    const id = await insightsDb.upsertCohortPattern({
      roleBucket:   'global',
      skillCluster: row.skill_name,
      patternType:  'skill_impact',
      finding: {
        skill:               row.skill_name,
        liftScore:           parseFloat(liftScore.toFixed(4)),
        skillSuccessRate:    parseFloat(skillSuccessRate.toFixed(4)),
        baselineSuccessRate: parseFloat(baselineSuccessRate.toFixed(4)),
        sampleSize:          row.sample_size,
      },
      cohortSize: row.sample_size,
    });
    patternIds.push(id);
  }

  console.log(`[SkillImpact] ${patternIds.length} skill_impact patterns upserted`);
  return patternIds;
}

module.exports = { computeSkillImpactPatterns };
