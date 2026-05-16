const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/subscription.controller');

router.get('/my', auth, ctrl.getMySubscription);
router.post('/subscribe', auth, ctrl.initiateSubscription);
router.post('/callback', ctrl.subscriptionCallback);
router.get('/plans', ctrl.getPlans);
router.get('/admin/all', auth, requireRole('ADMIN'), ctrl.getAllSubscriptions);
router.get('/admin/stats', auth, requireRole('ADMIN'), ctrl.getSubscriptionStats);

module.exports = router;
