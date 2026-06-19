const jobsService                = require('../services/jobs.service');
const { computeGhostScore }      = require('../services/ghostScore.service');
const { sendError, sendSuccess } = require('../utils/errors');

async function getDemandSupply(req, res) {
  try {
    const { skill, region } = req.query;
    const data = await jobsService.getDemandSupplyMap(skill, region);
    return sendSuccess(res, 200, { demandSupply: data });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function getGhostScore(req, res) {
  try {
    const { jdFingerprintHash, companyId, companyName } = req.query;

    if (!jdFingerprintHash) {
      return sendError(res, 400, 'jdFingerprintHash query parameter is required');
    }

    const result = await computeGhostScore(jdFingerprintHash, {
      companyId:   companyId   || null,
      companyName: companyName || null,
    });

    return sendSuccess(res, 200, result);
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { getDemandSupply, getGhostScore };
