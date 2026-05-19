const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/admin.controller');
const testimonialCtrl = require('../controllers/testimonial.controller');
const tipCtrl = require('../controllers/tip.controller');
const { getAdminWithdrawals, processWithdrawal } = require('../controllers/withdrawal.controller');
const videoCtrl = require('../controllers/video.controller');

const adminOnly = [auth, requireRole('ADMIN')];

router.get('/stats',                          ...adminOnly, ctrl.getStats);
router.get('/search',                         ...adminOnly, ctrl.adminSearch);
router.get('/badges',                         ...adminOnly, ctrl.adminBadges);
router.get('/providers/pending',              ...adminOnly, ctrl.getPendingProviders);
router.put('/providers/bulk-approve',         ...adminOnly, ctrl.bulkApproveProviders);
router.put('/providers/bulk-reject',          ...adminOnly, ctrl.bulkRejectProviders);
router.put('/providers/:id/approve',          ...adminOnly, ctrl.approveProvider);
router.put('/providers/:id/reject',           ...adminOnly, ctrl.rejectProvider);
router.put('/providers/:id/toggle-verified',  ...adminOnly, ctrl.toggleVerified);
router.get('/providers',                      ...adminOnly, ctrl.getAllProviders);
router.get('/users',                          ...adminOnly, ctrl.getUsers);
router.put('/users/:id/suspend',              ...adminOnly, ctrl.suspendUser);
router.delete('/users/:id',                   ...adminOnly, ctrl.deleteUser);
router.get('/bookings',                       ...adminOnly, ctrl.getAllBookings);
router.put('/bookings/:id/status',            ...adminOnly, ctrl.updateBookingStatus);
router.get('/revenue',                        ...adminOnly, ctrl.getRevenue);

// Testimonials approval routes
router.get('/testimonials/pending',           ...adminOnly, testimonialCtrl.getPendingTestimonials);
router.get('/testimonials/all',               ...adminOnly, testimonialCtrl.getApprovedTestimonials);
router.put('/testimonials/:id/approve',       ...adminOnly, testimonialCtrl.approveTestimonial);
router.put('/testimonials/:id/reject',        ...adminOnly, testimonialCtrl.rejectTestimonial);

// Tips approval routes
router.get('/tips/pending',                   ...adminOnly, tipCtrl.getAdminPendingTips);
router.get('/tips/approved',                  ...adminOnly, tipCtrl.getAdminApprovedTips);
router.put('/tips/:id/approve',               ...adminOnly, tipCtrl.approveTip);
router.put('/tips/:id/reject',                ...adminOnly, tipCtrl.rejectTip);

// Certificate review routes
router.get('/certificates/pending',           ...adminOnly, ctrl.getPendingCertificates);
router.put('/certificates/:id/approve',       ...adminOnly, ctrl.approveCertificate);
router.put('/certificates/:id/reject',        ...adminOnly, ctrl.rejectCertificate);

// Portfolio video review routes
router.get('/portfolio-videos/pending',       ...adminOnly, ctrl.getPendingPortfolioVideos);
router.put('/portfolio-videos/:id/approve',   ...adminOnly, ctrl.approvePortfolioVideo);
router.put('/portfolio-videos/:id/reject',    ...adminOnly, ctrl.rejectPortfolioVideo);

// Withdrawal management
router.get('/withdrawals',                    ...adminOnly, getAdminWithdrawals);
router.put('/withdrawals/:id/process',        ...adminOnly, processWithdrawal);

// CSV Export
router.get('/export',                         ...adminOnly, ctrl.exportData);

// Announcement Broadcast
router.post('/broadcast',                     ...adminOnly, ctrl.broadcastAnnouncement);

// Auto-Suspension
router.get('/auto-suspension/candidates',     ...adminOnly, ctrl.getAutoSuspensionCandidates);
router.post('/auto-suspension/run',           ...adminOnly, ctrl.runAutoSuspension);

// Subscription management
router.get('/subscriptions',              ...adminOnly, ctrl.getAdminSubscriptions);
router.get('/subscriptions/stats',        ...adminOnly, ctrl.getAdminSubscriptionStats);
router.put('/subscriptions/:id/waive',    ...adminOnly, ctrl.waiveSubscription);
router.put('/subscriptions/:id/extend',   ...adminOnly, ctrl.extendSubscription);

// ShowReel management (delete only — no approval flow)
router.get('/videos',                         ...adminOnly, videoCtrl.adminGetVideos);
router.get('/videos/reported',                ...adminOnly, (req, res, next) => { req.query.reported = 'true'; next(); }, videoCtrl.adminGetVideos);
router.delete('/videos/:id',                  ...adminOnly, videoCtrl.adminDeleteVideo);

module.exports = router;
