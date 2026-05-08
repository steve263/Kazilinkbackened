const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/referral.controller');

router.get('/my-code',      auth, ctrl.getMyReferralCode);
router.get('/my-referrals', auth, ctrl.getMyReferrals);
router.get('/my-rewards',   auth, ctrl.getMyRewards);
router.get('/stats',        auth, ctrl.getReferralStats);
router.post('/use-reward',  auth, ctrl.useReward);
router.get('/validate/:code',    ctrl.validateCode);

module.exports = router;
