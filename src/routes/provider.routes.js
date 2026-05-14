const express = require('express');
const router = express.Router();
const {
  getProviders, getProvider, getMyProvider, updateProvider,
  toggleOnline, updateLocation, getEarnings, getNearbyProviders,
  getAllServices, addService, updateService, deleteService,
  getSchedule, updateSchedule, addException, removeException, getAvailableSlots,
} = require('../controllers/provider.controller');
const { requestWithdrawal, getMyWithdrawals } = require('../controllers/withdrawal.controller');
const { auth, optionalAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');

router.get('/', getProviders);
router.get('/me', auth, requireRole('PROVIDER'), getMyProvider);
router.get('/nearby', getNearbyProviders);
// Availability schedule (must be before /:id)
router.put('/schedule',            auth, requireRole('PROVIDER'), updateSchedule);
router.post('/schedule/exception', auth, requireRole('PROVIDER'), addException);
router.delete('/schedule/exception/:id', auth, requireRole('PROVIDER'), removeException);
// Service CRUD (must be before /:id to avoid conflicts)
router.put('/services/:serviceId', auth, requireRole('PROVIDER'), updateService);
router.delete('/services/:serviceId', auth, requireRole('PROVIDER'), deleteService);
// Per-provider routes
router.get('/:id/earnings', auth, requireRole('PROVIDER', 'ADMIN'), getEarnings);
router.get('/:id/schedule', getSchedule);
router.get('/:id/available-slots', getAvailableSlots);
router.post('/withdrawals', auth, requireRole('PROVIDER'), requestWithdrawal);
router.get('/withdrawals/my', auth, requireRole('PROVIDER'), getMyWithdrawals);
router.get('/:id/services', optionalAuth, getAllServices);
router.post('/:id/services', auth, requireRole('PROVIDER'), addService);
router.get('/:id', getProvider);
router.put('/:id', auth, requireRole('PROVIDER', 'ADMIN'), updateProvider);
router.put('/:id/online', auth, requireRole('PROVIDER'), toggleOnline);
router.put('/:id/location', auth, requireRole('PROVIDER'), updateLocation);

// ── Availability & Waitlist ───────────────────────────────────────────────────
router.get('/:id/availability', async (req, res) => {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: req.params.id },
      select: {
        isBusy: true, busySince: true, businessName: true,
        waitlist: { where: { notified: false }, select: { id: true } },
      },
    });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    res.json({
      success: true,
      data: {
        isBusy: provider.isBusy,
        busySince: provider.busySince,
        waitlistCount: provider.waitlist.length,
        message: provider.isBusy
          ? `${provider.businessName} is currently busy`
          : `${provider.businessName} is available`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id/busy', auth, requireRole('PROVIDER'), async (req, res) => {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    if (provider.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    await prisma.provider.update({
      where: { id: req.params.id },
      data: { isBusy: false, busySince: null },
    });

    // Notify waitlist
    const { notifyWaitlist } = require('../controllers/booking.controller');
    notifyWaitlist(req.params.id, provider.businessName).catch(console.error);

    console.log(`🟢 ${provider.businessName} manually marked as available`);
    res.json({ success: true, data: { isBusy: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/waitlist', auth, async (req, res) => {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const existing = await prisma.providerWaitlist.findFirst({
      where: { providerId: req.params.id, customerId: req.user.id, notified: false },
    });
    if (existing) {
      return res.json({ success: true, data: { message: 'You are already on the waitlist!' } });
    }

    await prisma.providerWaitlist.create({
      data: { providerId: req.params.id, customerId: req.user.id, serviceId: req.body.serviceId || null },
    });
    console.log(`📋 ${req.user.name} joined waitlist for ${provider.businessName}`);
    res.json({
      success: true,
      data: { message: `You are on the waitlist! We will notify you when ${provider.businessName} is free.` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
