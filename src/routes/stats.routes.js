const router = require('express').Router();
const prisma = require('../config/db');

// Public stats for home/about pages
router.get('/', async (req, res) => {
  try {
    const [totalProviders, totalCustomers, totalCompletedBookings, totalReviews] = await Promise.all([
      prisma.provider.count({ where: { verificationStatus: 'APPROVED' } }),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.review.count(),
    ]);

    res.json({
      success: true,
      data: {
        totalProviders,
        totalCustomers,
        totalCompletedBookings,
        totalReviews,
        citiesCovered: 1,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
