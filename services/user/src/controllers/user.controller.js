const pdfParse  = require('pdf-parse');
const userService = require('../services/user.service');
const { parseResumeText, resumeQualityScore } = require('../utils/resumeParser');
const { sendError, sendSuccess } = require('../utils/errors');

async function getMe(req, res) {
  try {
    const user = await userService.getProfile(req.user.sub);
    return sendSuccess(res, 200, { user });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function updateMe(req, res) {
  try {
    const { name, email, target_role, target_location, years_of_experience } = req.body;

    const fields = {};
    if (name               !== undefined) fields.name               = name;
    if (email              !== undefined) fields.email              = email;
    if (target_role        !== undefined) fields.target_role        = target_role;
    if (target_location    !== undefined) fields.target_location    = target_location;
    if (years_of_experience !== undefined) {
      const parsed = parseInt(years_of_experience, 10);
      if (!Number.isNaN(parsed)) fields.years_of_experience = parsed;
    }

    if (Object.keys(fields).length === 0) {
      return sendError(res, 400, 'No valid fields to update');
    }

    const user = await userService.updateProfile(req.user.sub, fields);
    return sendSuccess(res, 200, { user });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function uploadResume(req, res) {
  if (!req.file) {
    return sendError(res, 400, 'No PDF file uploaded. Send a multipart/form-data request with field name "resume".');
  }

  try {
    const pdf     = await pdfParse(req.file.buffer);
    const rawText = pdf.text;

    if (!rawText || rawText.trim().length < 50) {
      return sendError(res, 422, 'Could not extract text from PDF. Ensure the file is not a scanned image.');
    }

    const parsed       = parseResumeText(rawText);
    const qualityScore = resumeQualityScore(parsed);
    const user         = await userService.saveResumeAndScore(req.user.sub, parsed, qualityScore);

    return sendSuccess(res, 200, {
      user,
      resume:    parsed,
      ats_score: qualityScore,
    });
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

async function getInsights(req, res) {
  try {
    const insights = await userService.getInsights(req.user.sub);
    return sendSuccess(res, 200, { insights });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function markInsightSeen(req, res) {
  try {
    const insight = await userService.markInsightSeen(req.params.id, req.user.sub);
    return sendSuccess(res, 200, { insight });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { getMe, updateMe, uploadResume, getResume, getInsights, markInsightSeen };
