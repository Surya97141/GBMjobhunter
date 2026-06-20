const { generateDiagnosis } = require('./diagnosticGenerator.service');
const axios = require('axios');
const insightsDb = require('../db/insights.db');
const usersDb    = require('../db/users.db');
const { buildSkillCluster } = require('./piiStripping');

function buildHeadline(pattern) {
  const { ghost_rate, avg_ats_score } = pattern.finding;
  const pct = Math.round(ghost_rate * 100);
  return `${pct}% of ${pattern.skill_cluster.replace(/\./g, ', ')} ${pattern.role_bucket} applicants are ghosted — avg ATS score: ${avg_ats_score}`;
}

function buildAction(pattern) {
  const { ghost_rate, avg_ats_score } = pattern.finding;
  if (ghost_rate > 0.6) {
    return `Consider tailoring your resume keywords more closely to the JD. The average ATS score for successful candidates in this cohort is ${avg_ats_score}.`;
  }
  if (avg_ats_score < 40) {
    return `Your ATS score is likely below average for this role type. Add more role-specific keywords from the job description.`;
  }
  return `You are tracking well for this cohort. Keep applying and following up after 7 days.`;
}

async function sendFcmNotification(userId, headline) {
  if (!process.env.FCM_SERVER_KEY) return;

  try {
    await axios.post(
      'https://fcm.googleapis.com/fcm/send',
      {
        to:           `/topics/user_${userId}`,
        notification: { title: 'New Insight', body: headline },
        data:         { type: 'new_insight' },
      },
      {
        headers: {
          Authorization: `key=${process.env.FCM_SERVER_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error(`[InsightPublisher] FCM notification failed for user ${userId}:`, err.message);
  }
}

async function publishInsightsForPatterns(patternIds) {
  if (!patternIds.length) return;

  const patterns = await insightsDb.getPatternsByIds(patternIds);
  console.log(`[InsightPublisher] Processing ${patterns.length} patterns`);

  for (const pattern of patterns) {
    const skills = pattern.skill_cluster.split('.');
    const users  = await usersDb.getUsersWithSkillsIn(skills);

    // Generate once per pattern — reused for every matched user in this run.
    // Any failure (not_configured, parse_error, other_error) falls through to
    // the existing templated strings, which are called exactly as before.
    const diagnosis = await generateDiagnosis(pattern);
    const headline  = diagnosis.success ? diagnosis.headline : buildHeadline(pattern);
    const action    = diagnosis.success ? diagnosis.action   : buildAction(pattern);
    const source    = diagnosis.success ? 'generated'        : 'templated';

    for (const user of users) {
      const userCluster = buildSkillCluster(user.resume_json);
      if (userCluster !== pattern.skill_cluster) continue;

      await insightsDb.createUserInsight({
        userId:    user.id,
        patternId: pattern.id,
        headline,
        action,
        source,
      });

      await sendFcmNotification(user.id, headline);
    }
  }

  console.log('[InsightPublisher] Done');
}

module.exports = { publishInsightsForPatterns };
