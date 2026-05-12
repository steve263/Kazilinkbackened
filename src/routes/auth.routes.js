const express = require('express');
const router = express.Router();
const { register, login, refresh, saveDeviceToken, changePassword, deactivateAccount } = require('../controllers/auth.controller');
const { forgotPassword, verifyOTP, resetPassword } = require('../controllers/password.controller');
const { auth, authSuspended } = require('../middleware/auth');
const prisma = require('../config/db');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', auth, refresh);
router.put('/device-token', auth, saveDeviceToken);
router.put('/change-password', auth, changePassword);
router.put('/deactivate', auth, deactivateAccount);

// Password reset flow (no auth required)
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

// Get current user — uses authSuspended so suspended users can still check their status
router.get('/me', authSuspended, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, phone: true, role: true, isSuspended: true,
        profilePhoto: true, location: true,
        provider: {
          select: { id: true, businessName: true, category: true, isVerified: true, isBusy: true },
        },
      },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
