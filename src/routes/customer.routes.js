const express = require('express');
const router = express.Router();
const {
  getProfile, updateProfile,
  createReview, getProviderReviews, getMyReviews,
  updateReview, deleteReview, markHelpful,
  getReviewableBooking,
  getSavedProviders, saveProvider, removeSavedProvider,
} = require('../controllers/customer.controller');
const { auth, requireRole } = require('../middleware/auth');

router.get('/profile', auth, requireRole('CUSTOMER'), getProfile);
router.put('/profile', auth, requireRole('CUSTOMER'), updateProfile);

// Reviews
router.post('/reviews', auth, requireRole('CUSTOMER'), createReview);
router.get('/reviews/my', auth, requireRole('CUSTOMER'), getMyReviews);
router.get('/reviews/reviewable/:providerId', auth, requireRole('CUSTOMER'), getReviewableBooking);
router.get('/reviews/provider/:providerId', getProviderReviews);
router.put('/reviews/:id/helpful', auth, markHelpful);
router.put('/reviews/:id', auth, requireRole('CUSTOMER'), updateReview);
router.delete('/reviews/:id', auth, requireRole('CUSTOMER'), deleteReview);

// Saved providers
router.get('/saved', auth, requireRole('CUSTOMER'), getSavedProviders);
router.post('/saved/:id', auth, requireRole('CUSTOMER'), saveProvider);
router.delete('/saved/:id', auth, requireRole('CUSTOMER'), removeSavedProvider);

module.exports = router;
