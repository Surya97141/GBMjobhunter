const { Router } = require('express');
const { getDemandSupply } = require('../controllers/jobs.controller');

const router = Router();

router.get('/demand-supply', getDemandSupply);

module.exports = router;
