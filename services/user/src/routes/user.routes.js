const { Router } = require('express');
const { getMe, updateMe, uploadResume, getResume, getInsights, markInsightSeen } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const router = Router();

router.use(requireAuth);

// Wraps multer so its errors (wrong MIME, file too large) are returned as JSON
// instead of crashing into Express's default HTML error page.
function handlePdfUpload(req, res, next) {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      return res.status(err.status || 400).json({ status: 'error', message: err.message });
    }
    next();
  });
}

router.get('/me',                    getMe);
router.put('/me',                    updateMe);
router.post('/me/resume',            handlePdfUpload, uploadResume);
router.get('/me/resume',             getResume);
router.get('/me/insights',           getInsights);
router.put('/me/insights/:id/seen',  markInsightSeen);

module.exports = router;
