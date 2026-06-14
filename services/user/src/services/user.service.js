const usersDb    = require('../db/users.db');
const insightsDb = require('../db/insights.db');

async function getProfile(userId) {
  const user = await usersDb.findUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return user;
}

async function updateProfile(userId, updates) {
  const user = await usersDb.updateUserProfile(userId, updates);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return user;
}

async function saveResume(userId, resumeJson) {
  const user = await usersDb.saveResume(userId, resumeJson);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return user;
}

async function saveResumeAndScore(userId, resumeJson, qualityScore) {
  const user = await usersDb.saveResume(userId, resumeJson);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  await usersDb.updateAtsCache(userId, qualityScore);
  return { ...user, ats_score_cache: qualityScore };
}

async function getResume(userId) {
  const resume = await usersDb.getResume(userId);
  if (!resume) {
    const err = new Error('No resume uploaded yet');
    err.statusCode = 404;
    throw err;
  }
  return resume;
}

async function getInsights(userId) {
  return insightsDb.getInsightsByUserId(userId);
}

async function markInsightSeen(insightId, userId) {
  const insight = await insightsDb.markInsightSeen(insightId, userId);
  if (!insight) {
    const err = new Error('Insight not found');
    err.statusCode = 404;
    throw err;
  }
  return insight;
}

module.exports = { getProfile, updateProfile, saveResume, saveResumeAndScore, getResume, getInsights, markInsightSeen };
