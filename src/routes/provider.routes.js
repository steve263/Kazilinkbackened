const express = require('express');
const router = express.Router();
const {
  getProviders, getProvider, updateProvider,
  toggleOnline, updateLocation, getEarnings, getNearbyProviders,
  getAllServices, addService, updateService, deleteService,
} = require('../controllers/provider.controller');
const { requestWithdrawal, getMyWithdrawals } = require('../controllers/withdrawal.controller');
const { auth, optionalAuth, requireRole } = require('../middleware/auth');

router.get('/', getProviders);
router.get('/nearby', getNearbyProviders);
// Service CRUD (must be before /:id to avoid conflicts)
router.put('/services/:serviceId', auth, requireRole('PROVIDER'), updateService);
router.delete('/services/:serviceId', auth, requireRole('PROVIDER'), deleteService);
// Per-provider routes
router.get('/:id/earnings', auth, requireRole('PROVIDER', 'ADMIN'), getEarnings);
router.post('/withdrawals', auth, requireRole('PROVIDER'), requestWithdrawal);
router.get('/withdrawals/my', auth, requireRole('PROVIDER'), getMyWithdrawals);
router.get('/:id/services', optionalAuth, getAllServices);
router.post('/:id/services', auth, requireRole('PROVIDER'), addService);
router.get('/:id', getProvider);
router.put('/:id', auth, requireRole('PROVIDER', 'ADMIN'), updateProvider);
router.put('/:id/online', auth, requireRole('PROVIDER'), toggleOnline);
router.put('/:id/location', auth, requireRole('PROVIDER'), updateLocation);

module.exports = router;
