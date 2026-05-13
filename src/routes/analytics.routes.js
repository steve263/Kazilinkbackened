const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/analytics.controller');

router.get('/overview',          auth, requireRole('ADMIN'), ctrl.getOverviewStats);
router.get('/daily-bookings',    auth, requireRole('ADMIN'), ctrl.getDailyBookings);
router.get('/revenue-by-category', auth, requireRole('ADMIN'), ctrl.getRevenueByCategory);
router.get('/top-providers',     auth, requireRole('ADMIN'), ctrl.getTopProviders);
router.get('/customer-growth',   auth, requireRole('ADMIN'), ctrl.getCustomerGrowth);
router.get('/booking-status',    auth, requireRole('ADMIN'), ctrl.getBookingStatusBreakdown);
router.get('/payment-stats',     auth, requireRole('ADMIN'), ctrl.getPaymentStats);
router.get('/recent-activity',   auth, requireRole('ADMIN'), ctrl.getRecentActivity);

module.exports = router;
