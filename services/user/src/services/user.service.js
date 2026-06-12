const usersDb = require('../db/users.db');

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

async function getResume(userId) {
  const resume = await usersDb.getResume(userId);
  if (!resume) {
    const err = new Error('No resume uploaded yet');
    err.statusCode = 404;
    throw err;
  }
  return resume;
}

module.exports = { getProfile, updateProfile, saveResume, getResume };
