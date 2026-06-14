const pdfParse  = require('pdf-parse');
const { z }     = require('zod');
const userService = require('../services/user.service');
const { parseResumeText, resumeQualityScore } = require('../utils/resumeParser');
const { sendError, sendSuccess } = require('../utils/errors');

const updateProfileSchema = z.object({
  email: z.string().email(),
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
  // multer runs before this — req.file is the PDF buffer
  if (!req.file) {
    return sendError(res, 400, 'No PDF file uploaded. Send a multipart/form-data request with field name "resume".');
  }

  try {
    // Extract raw text from the PDF buffer
    const pdf     = await pdfParse(req.file.buffer);
    const rawText = pdf.text;

    if (!rawText || rawText.trim().length < 50) {
      return sendError(res, 422, 'Could not extract text from PDF. Ensure the file is not a scanned image.');
    }

    // Parse raw text into structured resume JSON
    const parsed = parseResumeText(rawText);

    // Compute a quality/completeness score for ats_score_cache
    const qualityScore = resumeQualityScore(parsed);

    // Save resume JSON and update ATS cache
    const user = await userService.saveResumeAndScore(req.user.sub, parsed, qualityScore);

    return sendSuccess(res, 200, {
      user,
      resume: parsed,
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
