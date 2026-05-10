const express = require('express');
const router = express.Router();
const { auth, authSuspended, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/trust.controller');

// User-facing
router.post('/report',             auth, ctrl.submitReport);
router.get('/reports/my',          auth, ctrl.getMyReports);
router.get('/trust-score',         auth, ctrl.getMyTrustScore);
router.get('/trust-score/:userId',      ctrl.getUserTrustScore);

// Appeal routes (authSuspended so suspended users can access)
router.post('/appeal',                    authSuspended, ctrl.submitAppeal);
router.get('/appeal/my',                  authSuspended, ctrl.getMyAppeal);
router.post('/appeal/:id/provide-info',   authSuspended, ctrl.provideMoreInfo);

// Admin
router.get('/admin/stats',                    auth, requireRole('ADMIN'), ctrl.getTrustStats);
router.get('/admin/reports',                  auth, requireRole('ADMIN'), ctrl.getAllReports);
router.put('/admin/reports/:id/resolve',      auth, requireRole('ADMIN'), ctrl.resolveReport);
router.put('/admin/reports/:id/dismiss',      auth, requireRole('ADMIN'), ctrl.dismissReport);
router.get('/admin/fraud-alerts',             auth, requireRole('ADMIN'), ctrl.getFraudAlerts);
router.put('/admin/fraud-alerts/:id/resolve', auth, requireRole('ADMIN'), ctrl.resolveFraudAlert);
router.put('/admin/users/:id/suspend',        auth, requireRole('ADMIN'), ctrl.suspendUser);
router.put('/admin/users/:id/unsuspend',      auth, requireRole('ADMIN'), ctrl.unsuspendUser);
router.get('/admin/appeals',                  auth, requireRole('ADMIN'), ctrl.getAllAppeals);
router.put('/admin/appeals/:id/approve',      auth, requireRole('ADMIN'), ctrl.approveAppeal);
router.put('/admin/appeals/:id/reject',       auth, requireRole('ADMIN'), ctrl.rejectAppeal);
router.put('/admin/appeals/:id/request-info', auth, requireRole('ADMIN'), ctrl.requestMoreInfo);

module.exports = router;
