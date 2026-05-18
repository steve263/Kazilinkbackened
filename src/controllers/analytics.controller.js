const prisma = require('../config/db');

async function getOverviewStats(req, res) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalUsersLastMonth,
      totalProviders,
      totalBookings,
      totalBookingsLastMonth,
      completedBookings,
      totalRevenue,
      totalRevenueLastMonth,
      pendingProviders,
      activeBookingsToday,
      totalReviews,
      avgRating,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.user.count({
        where: { role: 'CUSTOMER', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      }),
      prisma.provider.count({ where: { isVerified: true } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { commission: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { commission: true },
      }),
      prisma.provider.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.booking.count({
        where: {
          status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
          scheduledDate: { gte: today },
        },
      }),
      prisma.review.count(),
      prisma.review.aggregate({ _avg: { rating: true } }),
    ]);

    const thisMonthBookings = await prisma.booking.count({
      where: { createdAt: { gte: startOfMonth } },
    });

    const thisMonthRevenue = await prisma.payment.aggregate({
      where: { status: 'SUCCESS', createdAt: { gte: startOfMonth } },
      _sum: { commission: true },
    });

    const thisMonthUsers = await prisma.user.count({
      where: { role: 'CUSTOMER', createdAt: { gte: startOfMonth } },
    });

    const bookingGrowth = totalBookingsLastMonth > 0
      ? Math.round(((thisMonthBookings - totalBookingsLastMonth) / totalBookingsLastMonth) * 100)
      : 0;

    const revenueGrowth = (totalRevenueLastMonth._sum.commission || 0) > 0
      ? Math.round((((thisMonthRevenue._sum.commission || 0) - (totalRevenueLastMonth._sum.commission || 0)) / (totalRevenueLastMonth._sum.commission || 0)) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        totalCustomers: totalUsers,
        totalProviders,
        totalBookings,
        completedBookings,
        completionRate: totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0,
        totalRevenue: Math.round(totalRevenue._sum.commission || 0),
        thisMonthRevenue: Math.round(thisMonthRevenue._sum.commission || 0),
        thisMonthBookings,
        thisMonthUsers,
        bookingGrowth,
        revenueGrowth,
        pendingProviders,
        activeBookingsToday,
        totalReviews,
        avgRating: Math.round((avgRating._avg.rating || 0) * 10) / 10,
      },
    });
  } catch (err) {
    console.error('❌ getOverviewStats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getDailyBookings(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const results = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const [bookings, revenue, completed] = await Promise.all([
        prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.payment.aggregate({
          where: { status: 'SUCCESS', createdAt: { gte: start, lte: end } },
          _sum: { commission: true },
        }),
        prisma.booking.count({
          where: { status: 'COMPLETED', updatedAt: { gte: start, lte: end } },
        }),
      ]);

      results.push({
        date: start.toISOString().split('T')[0],
        day: start.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }),
        bookings,
        revenue: Math.round(revenue._sum.commission || 0),
        completed,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRevenueByCategory(req, res) {
  try {
    const categories = ['FUNDI', 'SHOP', 'HOTEL', 'RESTAURANT', 'TECH', 'PROFESSIONAL'];
    const results = [];

    for (const category of categories) {
      const [revenue, bookings] = await Promise.all([
        prisma.payment.aggregate({
          where: { status: 'SUCCESS', booking: { provider: { category } } },
          _sum: { commission: true, amount: true },
        }),
        prisma.booking.count({ where: { provider: { category } } }),
      ]);

      results.push({
        category,
        revenue: Math.round(revenue._sum.commission || 0),
        totalAmount: Math.round(revenue._sum.amount || 0),
        bookings,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTopProviders(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const orderBy = req.query.orderBy || 'bookings';

    const providers = await prisma.provider.findMany({
      where: { isVerified: true },
      include: {
        user: { select: { name: true, location: true } },
        bookings: {
          where: { status: 'COMPLETED' },
          include: { payment: true },
        },
        _count: { select: { bookings: true, reviews: true } },
      },
      take: 50,
    });

    const enriched = providers.map((p) => {
      const totalRevenue = p.bookings.reduce(
        (sum, b) => sum + (b.payment?.providerAmount || 0), 0
      );
      return {
        id: p.id,
        businessName: p.businessName,
        category: p.category,
        location: p.user.location,
        rating: p.rating,
        totalReviews: p.totalReviews,
        completedBookings: p.bookings.length,
        totalRevenue: Math.round(totalRevenue),
        totalBookings: p._count.bookings,
      };
    });

    const sorted = enriched.sort((a, b) => {
      if (orderBy === 'revenue') return b.totalRevenue - a.totalRevenue;
      if (orderBy === 'rating') return b.rating - a.rating;
      return b.completedBookings - a.completedBookings;
    });

    res.json({ success: true, data: sorted.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getCustomerGrowth(req, res) {
  try {
    const months = parseInt(req.query.months) || 6;
    const results = [];

    for (let i = months - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      const [customers, providers, bookings] = await Promise.all([
        prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: start, lte: end } } }),
        prisma.provider.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } }),
      ]);

      results.push({
        month: start.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' }),
        customers,
        providers,
        bookings,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getBookingStatusBreakdown(req, res) {
  try {
    const statuses = ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'DECLINED'];
    const results = [];

    for (const status of statuses) {
      const count = await prisma.booking.count({ where: { status } });
      results.push({ status, count });
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    const withPercentage = results.map((r) => ({
      ...r,
      percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    }));

    res.json({ success: true, data: withPercentage });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getPaymentStats(req, res) {
  try {
    const [paid, pending, failed, refunded, totalAmount] = await Promise.all([
      prisma.payment.count({ where: { status: 'SUCCESS' } }),
      prisma.payment.count({ where: { status: 'PENDING' } }),
      prisma.payment.count({ where: { status: 'FAILED' } }),
      prisma.booking.count({ where: { paymentStatus: 'REFUNDED' } }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true, commission: true, providerAmount: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        paid,
        pending,
        failed,
        refunded,
        totalProcessed: Math.round(totalAmount._sum.amount || 0),
        totalCommission: Math.round(totalAmount._sum.commission || 0),
        totalProviderPayout: Math.round(totalAmount._sum.providerAmount || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRecentActivity(req, res) {
  try {
    const [recentBookings, recentUsers, recentPayments] = await Promise.all([
      prisma.booking.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          provider: { select: { businessName: true, category: true } },
          service: { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { name: true, role: true, createdAt: true, location: true },
      }),
      prisma.payment.findMany({
        take: 10,
        where: { status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        include: {
          booking: {
            include: {
              customer: { select: { name: true } },
              provider: { select: { businessName: true } },
            },
          },
        },
      }),
    ]);

    res.json({ success: true, data: { recentBookings, recentUsers, recentPayments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getOverviewStats,
  getDailyBookings,
  getRevenueByCategory,
  getTopProviders,
  getCustomerGrowth,
  getBookingStatusBreakdown,
  getPaymentStats,
  getRecentActivity,
};
