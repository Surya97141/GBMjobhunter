const { z } = require('zod');
const applicationsService = require('../services/applications.service');
const usersDb             = require('../db/users.db');
const { scoreResumeAgainstJD } = require('../utils/tfidf');
const { sendError, sendSuccess } = require('../utils/errors');

const logApplicationSchema = z.object({
  companyName: z.string().min(1),
  roleTitle:   z.string().min(1),
  jdText:      z.string().optional().default(''),
  pageUrl:     z.string().url().optional(),
});

const updateOutcomeSchema = z.object({
  outcome:      z.enum(['pending', 'ghosted', 'rejected', 'interview', 'offer']),
  responseDays: z.number().int().nonnegative().optional(),
});

async function logApplication(req, res) {
  const result = logApplicationSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const userId = req.headers['x-user-id'];
    const data   = await applicationsService.logApplication(userId, result.data);
    return sendSuccess(res, 201, data);
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function getApplications(req, res) {
  try {
    const userId = req.headers['x-user-id'];

    // Cap limit between 1 and 100; default to no limit (null = return all)
    const limit = req.query.limit
      ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100)
      : null;

    const offset = req.query.offset
      ? Math.max(parseInt(req.query.offset, 10), 0)
      : 0;

    const applications = await applicationsService.getUserApplications(userId, limit, offset);
    return sendSuccess(res, 200, { applications });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function getApplicationStats(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return sendError(res, 401, 'Unauthorised');
    }
    const stats = await applicationsService.getApplicationStats(userId);
    return sendSuccess(res, 200, { stats });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function updateOutcome(req, res) {
  const result = updateOutcomeSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const userId      = req.headers['x-user-id'];
    const { id }      = req.params;
    const application = await applicationsService.updateOutcome(
      id,
      userId,
      result.data.outcome,
      result.data.responseDays
    );
    return sendSuccess(res, 200, { application });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function scoreJD(req, res) {
  const { jdText } = req.body;
  if (!jdText || typeof jdText !== 'string' || jdText.trim().length < 10) {
    return sendError(res, 400, 'jdText is required (minimum 10 characters)');
  }
  try {
    const userId     = req.headers['x-user-id'];
    const resumeJson = await usersDb.getResumeByUserId(userId);
    if (!resumeJson) {
      return sendSuccess(res, 200, { score: null, reason: 'no_resume' });
    }
    const score = scoreResumeAgainstJD(resumeJson, jdText);
    return sendSuccess(res, 200, { score });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { logApplication, getApplications, getApplicationStats, updateOutcome, scoreJD };
