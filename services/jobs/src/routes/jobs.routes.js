const { Router } = require('express');
const { getDemandSupply, getGhostScore } = require('../controllers/jobs.controller');

const router = Router();

router.get('/demand-supply', getDemandSupply);
router.get('/ghost-score',   getGhostScore);

module.exports = router;
