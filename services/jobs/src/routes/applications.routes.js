const { Router } = require('express');
const {
  logApplication,
  getApplications,
  getApplicationStats,
  updateOutcome,
  scoreJD,
} = require('../controllers/applications.controller');

const router = Router();

// Literal-string routes must sit above /:id to avoid being treated as an id.
router.get('/stats',       getApplicationStats);
router.post('/score',      scoreJD);
router.get('/',            getApplications);
router.post('/',           logApplication);
router.put('/:id/outcome', updateOutcome);

module.exports = router;
