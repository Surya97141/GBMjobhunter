const { Router } = require('express');
const { logApplication, getApplications, updateOutcome } = require('../controllers/applications.controller');

const router = Router();

router.post('/',         logApplication);
router.get('/',          getApplications);
router.put('/:id/outcome', updateOutcome);

module.exports = router;
