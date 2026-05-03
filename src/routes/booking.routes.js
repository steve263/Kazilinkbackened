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
  getTracking,
} = require('../controllers/booking.controller');
const { auth, requireRole } = require('../middleware/auth');

router.post('/', auth, requireRole('CUSTOMER'), createBooking);
router.get('/', auth, getBookings);
router.get('/:id/tracking', auth, getTracking);
router.get('/:id', auth, getBooking);
router.put('/:id/accept', auth, requireRole('PROVIDER'), acceptBooking);
router.put('/:id/decline', auth, requireRole('PROVIDER'), declineBooking);
router.put('/:id/status', auth, requireRole('PROVIDER'), updateStatus);
router.delete('/:id', auth, requireRole('CUSTOMER'), cancelBooking);

module.exports = router;
