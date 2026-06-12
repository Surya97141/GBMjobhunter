const { z } = require('zod');
const applicationsService = require('../services/applications.service');
const { sendError, sendSuccess } = require('../utils/errors');

const logApplicationSchema = z.object({
  companyName: z.string().min(1),
  roleTitle:   z.string().min(1),
  jdText:      z.string().min(10),
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
    const userId      = req.headers['x-user-id'];
    const applications = await applicationsService.getUserApplications(userId);
    return sendSuccess(res, 200, { applications });
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

module.exports = { logApplication, getApplications, updateOutcome };
