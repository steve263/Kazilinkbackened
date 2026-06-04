const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/admin.controller');
const prisma = require('../config/db');
const notificationSvc = require('../services/notification.service');
const testimonialCtrl = require('../controllers/testimonial.controller');
const tipCtrl = require('../controllers/tip.controller');
const { getAdminWithdrawals, processWithdrawal } = require('../controllers/withdrawal.controller');
const videoCtrl = require('../controllers/video.controller');

const adminOnly = [auth, requireRole('ADMIN')];

router.get('/stats',                          ...adminOnly, ctrl.getStats);
router.get('/analytics',                      ...adminOnly, ctrl.getAnalytics);
router.get('/finance/export',                 ...adminOnly, ctrl.exportFinanceData);
router.get('/finance',                        ...adminOnly, ctrl.getFinanceData);
router.get('/search',                         ...adminOnly, ctrl.adminSearch);
router.get('/badges',                         ...adminOnly, ctrl.adminBadges);
router.get('/providers/pending',              ...adminOnly, ctrl.getPendingProviders);
router.put('/providers/bulk-approve',         ...adminOnly, ctrl.bulkApproveProviders);
router.put('/providers/bulk-reject',          ...adminOnly, ctrl.bulkRejectProviders);
router.put('/providers/:id/approve',          ...adminOnly, ctrl.approveProvider);
router.put('/providers/:id/reject',           ...adminOnly, ctrl.rejectProvider);
router.put('/providers/:id/toggle-verified',  ...adminOnly, ctrl.toggleVerified);
router.put('/providers/:id/toggle-busy',      ...adminOnly, ctrl.toggleBusy);
router.get('/providers',                      ...adminOnly, ctrl.getAllProviders);
router.get('/users',                          ...adminOnly, ctrl.getUsers);
router.put('/users/:id/suspend',              ...adminOnly, ctrl.suspendUser);
router.delete('/users/:id',                   ...adminOnly, ctrl.deleteUser);
router.get('/bookings',                       ...adminOnly, ctrl.getAllBookings);
router.put('/bookings/:id/status',            ...adminOnly, ctrl.updateBookingStatus);
router.put('/bookings/:id/payment-status',    ...adminOnly, ctrl.updateBookingPaymentStatus);
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

// Commission management (new unified admin routes)
router.get('/commissions',                ...adminOnly, ctrl.getAllCommissions);
router.put('/commissions/:id/confirm',    ...adminOnly, ctrl.confirmCommission);
router.put('/commissions/:id/reject',     ...adminOnly, ctrl.rejectCommission);
router.put('/commissions/:id/waive',      ...adminOnly, ctrl.waiveCommission);
router.put('/commissions/:id/suspend',    ...adminOnly, ctrl.suspendForCommission);

// Legacy: suspend-provider inline route (kept for backwards compat)
router.put('/commissions/:id/suspend-provider', ...adminOnly, async (req, res) => {
  try {
    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    await prisma.provider.update({
      where: { id: commission.providerId },
      data: { status: 'SUSPENDED' },
    });

    await notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '🚫 Account Suspended',
      body: `Your account has been suspended due to unpaid commission of KSh ${commission.amount}. Pay via Paybill 247247 (Account: 0795542312) and submit your Equity Bank confirmation to reactivate.`,
      bookingId: commission.bookingId,
    }).catch(console.error);

    res.json({ success: true, data: { message: 'Provider suspended for unpaid commission' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Disputes
router.get('/disputes',              ...adminOnly, ctrl.getDisputes);
router.get('/disputes/:id',          ...adminOnly, ctrl.getDisputeDetail);
router.put('/disputes/:id/release',  ...adminOnly, ctrl.releaseToProvider);
router.put('/disputes/:id/refund',   ...adminOnly, ctrl.refundToCustomer);

// App settings
router.get('/settings/verify', ...adminOnly, async (req, res) => {
  try {
    const result = await prisma.$queryRawUnsafe(
      `SELECT id, settings, "updatedAt" FROM "AppSettings" LIMIT 1`
    );
    res.json({
      success: true,
      found: result.length > 0,
      lastUpdated: result[0]?.updatedAt,
      data: result[0] ? JSON.parse(result[0].settings) : null,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
router.get('/settings',                       ...adminOnly, ctrl.getSettings);
router.put('/settings',                       ...adminOnly, ctrl.updateSettings);

// Verification document review
router.get('/verification',                   ...adminOnly, ctrl.getVerificationRequests);
router.get('/verification/:id',               ...adminOnly, ctrl.getVerificationDetail);
router.put('/verification/:id/approve',       ...adminOnly, ctrl.approveVerification);
router.put('/verification/:id/reject',        ...adminOnly, ctrl.rejectVerification);

// Subscription management
router.get('/subscriptions',              ...adminOnly, ctrl.getAdminSubscriptions);
router.get('/subscriptions/stats',        ...adminOnly, ctrl.getAdminSubscriptionStats);
router.put('/subscriptions/:id/waive',    ...adminOnly, ctrl.waiveSubscription);
router.put('/subscriptions/:id/extend',   ...adminOnly, ctrl.extendSubscription);

router.put('/subscriptions/:id/confirm-payment', ...adminOnly, async (req, res) => {
  try {
    const { paymentId, plan } = req.body;
    const planName = plan || 'STARTER';
    const planNames = { STARTER: 'Starter', GROWTH: 'Growth', PREMIUM: 'Premium' };

    const now = new Date();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    // Use raw SQL to avoid Prisma's ::SubscriptionStatus enum cast (enum may not exist in DB)
    await prisma.$executeRawUnsafe(
      `UPDATE "SubscriptionPayment" SET status = 'PAID', "paidAt" = $1 WHERE id = $2`,
      now, paymentId
    );

    await prisma.$executeRawUnsafe(
      `UPDATE "Subscription" SET status = 'ACTIVE', plan = $1, "currentPeriodStart" = $2, "currentPeriodEnd" = $3, "updatedAt" = NOW() WHERE id = $4`,
      planName, now, periodEnd, req.params.id
    );

    // Read provider info for notification (SELECT doesn't have enum cast issues)
    const sub = await prisma.subscription.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });

    if (sub?.provider?.userId) {
      await notificationSvc.createNotification({
        userId: sub.provider.userId,
        type: 'SYSTEM',
        title: '✅ Subscription Activated!',
        body: `Your ${planNames[planName] || 'Starter'} plan is now active for 30 days until ${periodEnd.toLocaleDateString('en-KE')}. Keep receiving bookings!`,
      });

      const smsSvc = require('../services/sms.service');
      smsSvc.sendSMS(
        sub.provider.user.phone,
        `KaziShow: Your ${planNames[planName] || 'Starter'} subscription is now ACTIVE for 30 days! Keep getting bookings on kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, data: { message: 'Subscription activated' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/subscriptions/payments/:paymentId/reject', ...adminOnly, async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "SubscriptionPayment" SET status = 'REJECTED' WHERE id = $1`,
      req.params.paymentId
    );
    res.json({ success: true, data: { message: 'Payment rejected' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Provider schedule + reminders
router.get('/schedule',        ...adminOnly, ctrl.getSchedule);
router.post('/schedule/remind', ...adminOnly, ctrl.sendReminder);

// Job applications — admin verifies payment only
router.get('/job-applications',                               ...adminOnly, ctrl.getJobApplications);
router.put('/job-applications/:appId/verify-payment',         ...adminOnly, ctrl.verifyJobPayment);
router.put('/job-applications/:appId/reject-payment',         ...adminOnly, ctrl.rejectJobPayment);

// ShowReel management (delete only — no approval flow)
router.get('/videos',                         ...adminOnly, videoCtrl.adminGetVideos);
router.get('/videos/reported',                ...adminOnly, (req, res, next) => { req.query.reported = 'true'; next(); }, videoCtrl.adminGetVideos);
router.delete('/videos/:id',                  ...adminOnly, videoCtrl.adminDeleteVideo);

module.exports = router;
