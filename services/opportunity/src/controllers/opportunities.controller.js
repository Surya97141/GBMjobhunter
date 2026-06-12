const { z } = require('zod');
const { buildRecommendations }      = require('../services/opportunities.service');
const { findMatchingCommunities }   = require('../services/communities.service');
const { sendError, sendSuccess }    = require('../utils/errors');

const querySchema = z.object({
  skills:    z.string().optional().transform(v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : []),
  interests: z.string().optional().transform(v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : []),
});

async function getOpportunities(req, res) {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const { skills, interests } = result.data;
    const recommendations = buildRecommendations(skills, interests);
    return sendSuccess(res, 200, { recommendations });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function getCommunities(req, res) {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const { skills, interests } = result.data;
    const communities = findMatchingCommunities(skills, interests);
    return sendSuccess(res, 200, { communities });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { getOpportunities, getCommunities };
