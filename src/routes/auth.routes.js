const express = require('express');
const router = express.Router();
const { register, login, refresh, saveDeviceToken, changePassword } = require('../controllers/auth.controller');
const { forgotPassword, verifyOTP, resetPassword } = require('../controllers/password.controller');
const { auth } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', auth, refresh);
router.put('/device-token', auth, saveDeviceToken);
router.put('/change-password', auth, changePassword);

// Password reset flow (no auth required)
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

module.exports = router;
