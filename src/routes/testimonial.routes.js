const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const {
  submitTestimonial,
  getApprovedTestimonials,
  getMyTestimonials,
  approveTestimonial,
  rejectTestimonial,
  incrementTestimonialViews,
  getPendingTestimonials,
} = require('../controllers/testimonial.controller');

// Public routes
router.get('/', getApprovedTestimonials);
router.put('/:id/views', incrementTestimonialViews);

// Auth required
router.post('/', auth, submitTestimonial);
router.get('/my', auth, getMyTestimonials);

// Admin routes
router.get('/admin/pending', admin, getPendingTestimonials);
router.put('/admin/:id/approve', admin, approveTestimonial);
router.put('/admin/:id/reject', admin, rejectTestimonial);

module.exports = router;
