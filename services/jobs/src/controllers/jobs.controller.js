const jobsService = require('../services/jobs.service');
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

module.exports = { getDemandSupply };
