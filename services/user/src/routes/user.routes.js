const { Router } = require('express');
const { getMe, updateMe, uploadResume, getResume } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.use(requireAuth);

router.get('/me', getMe);
router.put('/me', updateMe);
router.post('/me/resume', uploadResume);
router.get('/me/resume', getResume);

module.exports = router;
