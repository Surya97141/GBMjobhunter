const { Router } = require('express');
const { register, login, demo } = require('../controllers/auth.controller');

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/demo', demo);

module.exports = router;
