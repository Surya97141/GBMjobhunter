const { Router } = require('express');
const { getOpportunities, getCommunities } = require('../controllers/opportunities.controller');

const router = Router();

router.get('/',            getOpportunities);
router.get('/communities', getCommunities);

module.exports = router;
