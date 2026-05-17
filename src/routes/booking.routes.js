const express = require('express');
const router = express.Router();
const {
  createBooking,
  getBookings,
  getBooking,
  acceptBooking,
  declineBooking,
  updateStatus,
  cancelBooking,
  confirmJobComplete,
  getCancellationStats,
  getTracking,
  updateProviderLocation,
  markCashPaid,
  payCommission,
  commissionCallback,
  getOutstandingCommission,
  getAllCommissions,
  waiveCommission,
} = require('../controllers/booking.controller');
const { auth, requireRole } = require('../middleware/auth');

router.post('/', auth, requireRole('CUSTOMER'), createBooking);
router.get('/', auth, getBookings);

// Literal routes MUST come before /:id to avoid param capture
router.get('/admin/cancellations', auth, requireRole('ADMIN'), getCancellationStats);
router.get('/admin/commissions', auth, requireRole('ADMIN'), getAllCommissions);
router.post('/commission-callback', commissionCallback);
router.get('/my-commissions', auth, requireRole('PROVIDER'), getOutstandingCommission);

router.get('/:id/tracking', auth, getTracking);
router.post('/:id/location', auth, updateProviderLocation);
router.get('/:id', auth, getBooking);
router.put('/:id/accept', auth, requireRole('PROVIDER'), acceptBooking);
router.put('/:id/decline', auth, requireRole('PROVIDER'), declineBooking);
router.put('/:id/status', auth, requireRole('PROVIDER'), updateStatus);
router.post('/:id/cancel', auth, cancelBooking);
router.put('/:id/confirm-complete', auth, requireRole('CUSTOMER'), confirmJobComplete);
router.post('/:id/mark-cash-paid', auth, requireRole('PROVIDER'), markCashPaid);
router.post('/commissions/:id/pay', auth, requireRole('PROVIDER'), payCommission);
router.put('/commissions/:id/waive', auth, requireRole('ADMIN'), waiveCommission);

module.exports = router;
