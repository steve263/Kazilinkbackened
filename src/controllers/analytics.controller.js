const prisma = require('../config/db');

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;

// Helper: safely resolve Promise.allSettled results
const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

// Revenue = totalAmount on COMPLETED bookings (covers cash + M-Pesa)
// Commission = totalAmount * COMMISSION_RATE
const revWhere = {
  status: 'COMPLETED',
  totalAmount: { gt: 0 },
};

async function getOverviewStats(req, res) {
  try {
    const now = new Date();
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const today          = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const results = await Promise.allSettled([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.provider.count({ where: { isVerified: true } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.booking.aggregate({ where: revWhere, _sum: { totalAmount: true } }),
      prisma.booking.aggregate({ where: { ...revWhere, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { totalAmount: true } }),
      prisma.booking.aggregate({ where: { ...revWhere, createdAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      prisma.booking.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.booking.count({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: monthStart } } }),
      prisma.provider.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.booking.count({ where: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'PREPARING', 'READY'] }, createdAt: { gte: today } } }),
      prisma.review.count(),
      prisma.review.aggregate({ _avg: { rating: true } }),
    ]);

    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`⚠️ analytics/overview query[${i}] failed:`, r.reason?.message);
    });

    const totalCustomers       = settled(results[0])  ?? 0;
    const totalProviders       = settled(results[1])  ?? 0;
    const totalBookings        = settled(results[2])  ?? 0;
    const completedBookings    = settled(results[3])  ?? 0;
    const totalRevAgg          = settled(results[4])  ?? { _sum: { totalAmount: null } };
    const lastMonthRevAgg      = settled(results[5])  ?? { _sum: { totalAmount: null } };
    const thisMonthRevAgg      = settled(results[6])  ?? { _sum: { totalAmount: null } };
    const thisMonthBookings    = settled(results[7])  ?? 0;
    const lastMonthBookings    = settled(results[8])  ?? 0;
    const thisMonthUsers       = settled(results[9])  ?? 0;
    const pendingProviders     = settled(results[10]) ?? 0;
    const activeBookingsToday  = settled(results[11]) ?? 0;
    const totalReviews         = settled(results[12]) ?? 0;
    const avgRatingAgg         = settled(results[13]) ?? { _avg: { rating: null } };

    const totalRevenue     = Math.round((totalRevAgg._sum?.totalAmount    || 0) * COMMISSION_RATE);
    const thisMonthRevenue = Math.round((thisMonthRevAgg._sum?.totalAmount || 0) * COMMISSION_RATE);
    const lastMonthRevenue = Math.round((lastMonthRevAgg._sum?.totalAmount || 0) * COMMISSION_RATE);

    const bookingGrowth = lastMonthBookings > 0
      ? Math.round(((thisMonthBookings - lastMonthBookings) / lastMonthBookings) * 100) : 0;
    const revenueGrowth = lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalCustomers,
        totalProviders,
        totalBookings,
        completedBookings,
        completionRate: totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0,
        totalRevenue,
        thisMonthRevenue,
        thisMonthBookings,
        thisMonthUsers,
        bookingGrowth,
        revenueGrowth,
        pendingProviders,
        activeBookingsToday,
        totalReviews,
        avgRating: Math.round((avgRatingAgg._avg?.rating || 0) * 10) / 10,
      },
    });
  } catch (err) {
    console.error('❌ getOverviewStats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getDailyBookings(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    // Fetch all relevant bookings in one query
    const [allBookings, completedBookings] = await Promise.all([
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.booking.findMany({
        where: { status: 'COMPLETED', updatedAt: { gte: since }, totalAmount: { gt: 0 } },
        select: { updatedAt: true, totalAmount: true },
      }),
    ]);

    // Build a map: dateStr -> { bookings, revenue, completed }
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      map.set(key, {
        date: key,
        day: d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }),
        bookings: 0,
        revenue: 0,
        completed: 0,
      });
    }

    for (const b of allBookings) {
      const key = new Date(b.createdAt).toISOString().split('T')[0];
      if (map.has(key)) map.get(key).bookings++;
    }
    for (const b of completedBookings) {
      const key = new Date(b.updatedAt).toISOString().split('T')[0];
      if (map.has(key)) {
        const entry = map.get(key);
        entry.completed++;
        entry.revenue += Math.round((b.totalAmount || 0) * COMMISSION_RATE);
      }
    }

    res.json({ success: true, data: [...map.values()] });
  } catch (err) {
    console.error('❌ getDailyBookings error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRevenueByCategory(req, res) {
  try {
    const categories = ['FUNDI', 'SHOP', 'HOTEL', 'RESTAURANT', 'TECH', 'PROFESSIONAL'];

    const results = await Promise.allSettled(
      categories.map((category) =>
        Promise.all([
          prisma.booking.aggregate({
            where: { ...revWhere, provider: { category } },
            _sum: { totalAmount: true },
            _count: true,
          }),
          prisma.booking.count({ where: { provider: { category } } }),
        ])
      )
    );

    const data = categories.map((category, i) => {
      const r = settled(results[i]);
      const [agg, bookings] = r || [{ _sum: { totalAmount: null }, _count: 0 }, 0];
      const totalAmount = agg._sum?.totalAmount || 0;
      return {
        category,
        revenue: Math.round(totalAmount * COMMISSION_RATE),
        totalAmount: Math.round(totalAmount),
        bookings,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ getRevenueByCategory error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTopProviders(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const providers = await prisma.provider.findMany({
      include: {
        user: { select: { name: true, location: true } },
        bookings: {
          where: { status: 'COMPLETED', totalAmount: { gt: 0 } },
          select: { totalAmount: true },
        },
        _count: { select: { bookings: true } },
      },
      take: 100,
    });

    const enriched = providers.map((p) => {
      const totalAmount  = p.bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
      const totalRevenue = Math.round(totalAmount * (1 - COMMISSION_RATE));
      return {
        id: p.id,
        businessName: p.businessName,
        category: p.category,
        location: p.user.location,
        rating: p.rating || 0,
        totalReviews: p.totalReviews || 0,
        completedBookings: p.bookings.length,
        totalRevenue,
        totalBookings: p._count.bookings,
      };
    });

    // Sort by completed bookings by default (frontend can resort)
    enriched.sort((a, b) => b.completedBookings - a.completedBookings);

    res.json({ success: true, data: enriched.slice(0, limit) });
  } catch (err) {
    console.error('❌ getTopProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getCustomerGrowth(req, res) {
  try {
    const months = Math.min(parseInt(req.query.months) || 6, 12);
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    // Fetch everything in 3 queries instead of N×3
    const [customers, providers, bookings] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'CUSTOMER', createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.provider.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
    ]);

    const results = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const label = start.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });

      const inRange = (date) => date >= start && date <= end;

      results.push({
        month: label,
        customers: customers.filter((u) => inRange(new Date(u.createdAt))).length,
        providers: providers.filter((p) => inRange(new Date(p.createdAt))).length,
        bookings:  bookings.filter((b)  => inRange(new Date(b.createdAt))).length,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('❌ getCustomerGrowth error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getBookingStatusBreakdown(req, res) {
  try {
    const statuses = ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED', 'DISPUTED'];

    // Single groupBy instead of N separate count queries
    const grouped = await prisma.booking.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const countMap = {};
    for (const g of grouped) countMap[g.status] = g._count._all;
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);

    const withPercentage = statuses
      .map((status) => ({
        status,
        count: countMap[status] || 0,
        percentage: total > 0 ? Math.round(((countMap[status] || 0) / total) * 100) : 0,
      }))
      .filter((s) => s.count > 0); // only show statuses that have data

    res.json({ success: true, data: withPercentage });
  } catch (err) {
    console.error('❌ getBookingStatusBreakdown error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getPaymentStats(req, res) {
  try {
    const results = await Promise.allSettled([
      prisma.booking.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.aggregate({ where: { paymentStatus: 'REFUNDED' }, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.aggregate({ where: { paymentStatus: 'REFUND_REQUESTED' }, _count: true }),
      prisma.booking.aggregate({ where: { status: 'COMPLETED', totalAmount: { gt: 0 } }, _sum: { totalAmount: true } }),
    ]);

    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`⚠️ analytics/payment-stats query[${i}] failed:`, r.reason?.message);
    });

    const paidAgg      = settled(results[0]) ?? { _sum: { totalAmount: null }, _count: 0 };
    const refundedAgg  = settled(results[1]) ?? { _sum: { totalAmount: null }, _count: 0 };
    const refReqAgg    = settled(results[2]) ?? { _count: 0 };
    const completedAgg = settled(results[3]) ?? { _sum: { totalAmount: null } };

    const totalProcessed     = Math.round(paidAgg._sum?.totalAmount    || 0);
    const totalCompleted     = Math.round(completedAgg._sum?.totalAmount || 0);
    const totalCommission    = Math.round(totalCompleted * COMMISSION_RATE);
    const totalProviderPayout = Math.round(totalCompleted * (1 - COMMISSION_RATE));

    res.json({
      success: true,
      data: {
        paid: paidAgg._count || 0,
        refunded: refundedAgg._count || 0,
        refundRequested: refReqAgg._count || 0,
        totalProcessed,
        totalCommission,
        totalProviderPayout,
        totalRefundAmount: Math.round(refundedAgg._sum?.totalAmount || 0),
      },
    });
  } catch (err) {
    console.error('❌ getPaymentStats error:', err.message);
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
          service:  { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { name: true, role: true, createdAt: true, location: true },
      }),
      // Use completed MPESA bookings as "payments" since Payment table may be sparse
      prisma.booking.findMany({
        take: 10,
        where: { status: 'COMPLETED', paymentStatus: 'PAID', totalAmount: { gt: 0 } },
        orderBy: { updatedAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          provider: { select: { businessName: true } },
        },
      }),
    ]);

    // Normalize recentPayments to same shape the frontend expects
    const normalizedPayments = recentPayments.map((b) => ({
      id: b.id,
      amount: b.totalAmount,
      booking: {
        customer: b.customer,
        provider: b.provider,
      },
    }));

    res.json({ success: true, data: { recentBookings, recentUsers, recentPayments: normalizedPayments } });
  } catch (err) {
    console.error('❌ getRecentActivity error:', err.message);
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
