const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/earnings.controller');

// Provider earnings
router.get('/summary',  auth, requireRole('PROVIDER'), ctrl.getEarningsSummary);
router.get('/history',  auth, requireRole('PROVIDER'), ctrl.getEarningsHistory);
router.post('/payout',  auth, requireRole('PROVIDER'), ctrl.requestPayout);
router.get('/payouts',  auth, requireRole('PROVIDER'), ctrl.getMyPayouts);

// Admin payout management
router.get('/admin/payouts',            auth, requireRole('ADMIN'), ctrl.getAllPayouts);
router.put('/admin/payouts/:id/approve', auth, requireRole('ADMIN'), ctrl.approvePayout);
router.put('/admin/payouts/:id/reject',  auth, requireRole('ADMIN'), ctrl.rejectPayout);

module.exports = router;
