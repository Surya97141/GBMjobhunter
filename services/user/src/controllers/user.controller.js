const { z } = require('zod');
const userService = require('../services/user.service');
const { sendError, sendSuccess } = require('../utils/errors');

const updateProfileSchema = z.object({
  email: z.string().email(),
});

const resumeSchema = z.object({
  personalInfo: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    location: z.string().optional(),
    linkedin: z.string().url().optional(),
  }),
  skills: z.array(z.string()),
  workExperience: z.array(z.object({
    company: z.string(),
    role: z.string(),
    startDate: z.string(),
    endDate: z.string().optional(),
    description: z.string().optional(),
  })),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    year: z.number().optional(),
  })).optional(),
});

async function getMe(req, res) {
  try {
    const user = await userService.getProfile(req.user.sub);
    return sendSuccess(res, 200, { user });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function updateMe(req, res) {
  const result = updateProfileSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const user = await userService.updateProfile(req.user.sub, result.data);
    return sendSuccess(res, 200, { user });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function uploadResume(req, res) {
  const result = resumeSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const user = await userService.saveResume(req.user.sub, result.data);
    return sendSuccess(res, 200, { user });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function getResume(req, res) {
  try {
    const resume = await userService.getResume(req.user.sub);
    return sendSuccess(res, 200, { resume });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { getMe, updateMe, uploadResume, getResume };
