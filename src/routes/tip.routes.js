const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const {
  createTip,
  getApprovedTips,
  getTipById,
  getMyTips,
  updateTip,
  deleteTip,
  addTipComment,
  likeTip,
  getAdminPendingTips,
  getAdminApprovedTips,
  approveTip,
  rejectTip,
} = require('../controllers/tip.controller');

// Public routes
router.get('/', getApprovedTips);

// Auth required (must be before /:id to avoid route shadowing)
router.post('/', auth, createTip);
router.get('/my', auth, getMyTips);

router.get('/:id', getTipById);
router.put('/:id', auth, updateTip);
router.delete('/:id', auth, deleteTip);
router.post('/:id/comments', auth, addTipComment);
router.put('/:id/like', auth, likeTip);

// Admin routes
router.get('/admin/pending', admin, getAdminPendingTips);
router.get('/admin/approved', admin, getAdminApprovedTips);
router.put('/admin/:id/approve', admin, approveTip);
router.put('/admin/:id/reject', admin, rejectTip);

module.exports = router;
