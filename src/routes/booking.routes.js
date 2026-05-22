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
  getCommissionForPayment,
  submitCommissionCode,
  getAllCommissions,
  waiveCommission,
  confirmCommissionPayment,
  rejectCommissionPayment,
  disputeJob,
  requestRefund,
  markRefundProcessed,
  sendB2CRefund,
} = require('../controllers/booking.controller');
const { auth, requireRole } = require('../middleware/auth');

router.post('/', auth, requireRole('CUSTOMER'), createBooking);
router.get('/', auth, getBookings);

// Literal routes MUST come before /:id to avoid param capture
router.get('/admin/cancellations', auth, requireRole('ADMIN'), getCancellationStats);
router.put('/admin/cancellations/:id/refund-processed', auth, requireRole('ADMIN'), markRefundProcessed);
router.post('/admin/cancellations/:id/send-b2c', auth, requireRole('ADMIN'), sendB2CRefund);
router.get('/admin/commissions', auth, requireRole('ADMIN'), getAllCommissions);
router.post('/commission-callback', commissionCallback);
router.get('/my-commissions', auth, requireRole('PROVIDER'), getOutstandingCommission);
router.get('/commission/outstanding', auth, requireRole('PROVIDER'), getOutstandingCommission);
router.post('/commission/:id/submit-code', auth, requireRole('PROVIDER'), submitCommissionCode);

router.get('/:id/tracking', auth, getTracking);
router.post('/:id/location', auth, updateProviderLocation);
router.get('/:id', auth, getBooking);
router.put('/:id/accept', auth, requireRole('PROVIDER'), acceptBooking);
router.put('/:id/decline', auth, requireRole('PROVIDER'), declineBooking);
router.put('/:id/status', auth, requireRole('PROVIDER'), updateStatus);
router.post('/:id/cancel', auth, cancelBooking);
router.put('/:id/confirm-complete', auth, requireRole('CUSTOMER'), confirmJobComplete);
router.post('/:id/dispute', auth, requireRole('CUSTOMER'), disputeJob);
router.post('/:id/refund', auth, requireRole('CUSTOMER'), requestRefund);
router.post('/:id/mark-cash-paid', auth, requireRole('PROVIDER'), markCashPaid);
router.post('/commissions/:id/pay', auth, requireRole('PROVIDER'), payCommission);
router.put('/commissions/:id/waive', auth, requireRole('ADMIN'), waiveCommission);
router.put('/commissions/:id/confirm-payment', auth, requireRole('ADMIN'), confirmCommissionPayment);
router.put('/commissions/:id/reject-payment', auth, requireRole('ADMIN'), rejectCommissionPayment);

module.exports = router;
