const { Router } = require('express');
const {
  logApplication,
  getApplications,
  getApplicationStats,
  updateOutcome,
} = require('../controllers/applications.controller');

const router = Router();

// /stats must sit above /:id — Express matches top-to-bottom and would
// otherwise treat the literal string "stats" as an application id.
router.get('/stats',       getApplicationStats);
router.get('/',            getApplications);
router.post('/',           logApplication);
router.put('/:id/outcome', updateOutcome);

module.exports = router;
