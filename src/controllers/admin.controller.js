const prisma = require('../config/db');
const smsSvc = require('../services/sms.service');
const emailSvc = require('../services/email.service');

// ─── Stats ────────────────────────────────────────────────────────────────────

async function getStats(req, res) {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(todayStart - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      usersLastWeek,
      bookingsToday,
      bookingsYesterday,
      revenueMonth,
      revenueLastMonth,
      pendingProviders,
      activeBookings,
      totalReviews,
      reviewsLastWeek,
      newUsersThisWeek,
      newUsersLastWeek,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { lt: weekAgo } } }),
      prisma.booking.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.booking.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.payment.aggregate({ where: { status: 'SUCCESS', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.payment.aggregate({
        where: {
          status: 'SUCCESS',
          createdAt: {
            gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
            lt: monthStart,
          },
        },
        _sum: { amount: true },
      }),
      prisma.provider.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.booking.count({
        where: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'PREPARING', 'READY'] } },
      }),
      prisma.review.count(),
      prisma.review.count({ where: { createdAt: { lt: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    ]);

    const pct = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      success: true,
      data: {
        totalUsers: { value: totalUsers, change: pct(newUsersThisWeek, newUsersLastWeek) },
        bookingsToday: { value: bookingsToday, change: pct(bookingsToday, bookingsYesterday) },
        revenueThisMonth: {
          value: revenueMonth._sum.amount || 0,
          change: pct(revenueMonth._sum.amount || 0, revenueLastMonth._sum.amount || 0),
        },
        pendingProviders: { value: pendingProviders, change: 0 },
        activeBookings: { value: activeBookings, change: 0 },
        totalReviews: { value: totalReviews, change: pct(totalReviews - reviewsLastWeek, reviewsLastWeek) },
      },
    });
  } catch (err) {
    console.error('❌ getStats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Pending Providers ────────────────────────────────────────────────────────

async function getPendingProviders(req, res) {
  try {
    const providers = await prisma.provider.findMany({
      where: { verificationStatus: 'PENDING' },
      include: { user: { select: { id: true, name: true, phone: true, location: true, createdAt: true, profilePhoto: true } } },
      orderBy: { user: { createdAt: 'asc' } },
    });
    res.json({ success: true, data: providers });
  } catch (err) {
    console.error('❌ getPendingProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approveProvider(req, res) {
  try {
    const provider = await prisma.provider.update({
      where: { id: req.params.id },
      data: { verificationStatus: 'APPROVED', isVerified: true },
      include: { user: true },
    });

    console.log(`✅ Admin approved provider: ${provider.businessName}`);

    smsSvc
      .sendSMS(provider.user.phone, `Congratulations! Your KaziShow profile has been approved. You are now live on the platform. Download the app: kazishow.co.ke`)
      .catch(console.error);

    emailSvc.sendEmail({
      to: provider.user.email,
      subject: '🎉 Your KaziShow Profile is Now Live!',
      html: emailSvc.tplProviderApproved({ providerName: provider.user.name, businessName: provider.businessName }),
    }).catch(console.error);

    prisma.notification.create({
      data: {
        userId: provider.userId,
        type: 'SYSTEM',
        title: 'Profile Approved! 🎉',
        body: 'Congratulations! Your profile is now live on KaziShow.',
      },
    }).catch(console.error);

    res.json({ success: true, data: provider });
  } catch (err) {
    console.error('❌ approveProvider error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectProvider(req, res) {
  try {
    const { reason = 'Documents could not be verified' } = req.body;

    const provider = await prisma.provider.update({
      where: { id: req.params.id },
      data: { verificationStatus: 'REJECTED', isVerified: false },
      include: { user: true },
    });

    console.log(`❌ Admin rejected provider: ${provider.businessName} — ${reason}`);

    smsSvc
      .sendSMS(provider.user.phone, `Your KaziShow application was not approved. Reason: ${reason}. Please reapply with correct documents.`)
      .catch(console.error);

    emailSvc.sendEmail({
      to: provider.user.email,
      subject: 'Your KaziShow Application Was Not Approved',
      html: emailSvc.tplProviderRejected({ providerName: provider.user.name, businessName: provider.businessName, reason }),
    }).catch(console.error);

    res.json({ success: true, data: provider });
  } catch (err) {
    console.error('❌ rejectProvider error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function getUsers(req, res) {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (role && role !== 'ALL') where.role = role.toUpperCase();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, phone: true, role: true,
          location: true, isActive: true, createdAt: true,
          _count: { select: { bookingsAsCustomer: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: { users, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } },
    });
  } catch (err) {
    console.error('❌ getUsers error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function suspendUser(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'ADMIN') return res.status(403).json({ success: false, message: 'Cannot suspend an admin' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: { id: true, name: true, isActive: true },
    });

    console.log(`🚫 Admin ${updated.isActive ? 'unsuspended' : 'suspended'} user: ${updated.name}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ suspendUser error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteUser(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'ADMIN') return res.status(403).json({ success: false, message: 'Cannot delete an admin' });

    await prisma.user.delete({ where: { id: req.params.id } });
    console.log(`🗑️ Admin deleted user: ${user.name} (${user.phone})`);
    res.json({ success: true, data: { message: 'User deleted' } });
  } catch (err) {
    console.error('❌ deleteUser error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

async function getAllProviders(req, res) {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (category && category !== 'ALL') where.category = category.toUpperCase();
    if (status && status !== 'ALL') where.verificationStatus = status.toUpperCase();
    if (search) where.businessName = { contains: search, mode: 'insensitive' };

    const [providers, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true, location: true, isActive: true } },
          _count: { select: { bookings: true, reviews: true, followers: true } },
        },
        orderBy: { rating: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.provider.count({ where }),
    ]);

    res.json({
      success: true,
      data: { providers, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } },
    });
  } catch (err) {
    console.error('❌ getAllProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleVerified(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const updated = await prisma.provider.update({
      where: { id: req.params.id },
      data: { isVerified: !provider.isVerified },
    });

    console.log(`🔖 Admin toggled verified for ${provider.businessName}: ${updated.isVerified}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ toggleVerified error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

async function getAllBookings(req, res) {
  try {
    const { page = 1, limit = 20, status, search, dateFrom, dateTo } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && status !== 'ALL') where.status = status.toUpperCase();
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { provider: { businessName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          provider: { select: { id: true, businessName: true, category: true } },
          service: { select: { name: true } },
          payment: { select: { status: true, amount: true, mpesaRef: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({
      success: true,
      data: { bookings, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } },
    });
  } catch (err) {
    console.error('❌ getAllBookings error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateBookingStatus(req, res) {
  try {
    const { status } = req.body;
    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: status.toUpperCase() },
    });
    console.log(`🔄 Admin updated booking ${req.params.id} → ${status}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Revenue & Analytics ──────────────────────────────────────────────────────

async function getRevenue(req, res) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Daily bookings (last 30 days) — raw query for date grouping
    const dailyBookings = await prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "Booking"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    // Revenue by provider category
    const revenueByCategory = await prisma.$queryRaw`
      SELECT p.category, COALESCE(SUM(pay.amount), 0)::int as revenue, COUNT(b.id)::int as bookings
      FROM "Provider" p
      LEFT JOIN "Booking" b ON b."providerId" = p.id
      LEFT JOIN "Payment" pay ON pay."bookingId" = b.id AND pay.status = 'SUCCESS'
      GROUP BY p.category
      ORDER BY revenue DESC
    `;

    // Top 5 providers by bookings (this month)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const topByBookings = await prisma.provider.findMany({
      select: {
        id: true,
        businessName: true,
        category: true,
        rating: true,
        _count: { select: { bookings: true } },
      },
      orderBy: { bookings: { _count: 'desc' } },
      take: 5,
    });

    // Top 5 providers by revenue
    const topByRevenue = await prisma.$queryRaw`
      SELECT p.id, p."businessName", p.category, COALESCE(SUM(pay.amount), 0)::int as revenue
      FROM "Provider" p
      LEFT JOIN "Booking" b ON b."providerId" = p.id
      LEFT JOIN "Payment" pay ON pay."bookingId" = b.id AND pay.status = 'SUCCESS'
      GROUP BY p.id, p."businessName", p.category
      ORDER BY revenue DESC
      LIMIT 5
    `;

    // Completion rate
    const [completed, cancelled, total] = await Promise.all([
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.booking.count({ where: { status: 'CANCELLED' } }),
      prisma.booking.count(),
    ]);

    res.json({
      success: true,
      data: {
        dailyBookings,
        revenueByCategory,
        topByBookings,
        topByRevenue,
        completionRate: { completed, cancelled, total, rate: total > 0 ? Math.round((completed / total) * 100) : 0 },
      },
    });
  } catch (err) {
    console.error('❌ getRevenue error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Certificate review ───────────────────────────────────────────────────────

async function getPendingCertificates(req, res) {
  try {
    const certs = await prisma.certificate.findMany({
      where: { status: 'PENDING' },
      include: {
        provider: {
          select: { id: true, businessName: true, category: true, user: { select: { name: true, phone: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: certs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approveCertificate(req, res) {
  try {
    const cert = await prisma.certificate.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
    });
    res.json({ success: true, data: cert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectCertificate(req, res) {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Rejection reason required' });
    const cert = await prisma.certificate.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectReason: reason.trim() },
    });
    res.json({ success: true, data: cert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Portfolio video review ───────────────────────────────────────────────────

async function getPendingPortfolioVideos(req, res) {
  try {
    const videos = await prisma.portfolioVideo.findMany({
      where: { status: 'PENDING' },
      include: {
        provider: {
          select: { id: true, businessName: true, category: true, user: { select: { name: true, phone: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approvePortfolioVideo(req, res) {
  try {
    const video = await prisma.portfolioVideo.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
    });
    res.json({ success: true, data: video });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectPortfolioVideo(req, res) {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Rejection reason required' });
    const video = await prisma.portfolioVideo.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectReason: reason.trim() },
    });
    res.json({ success: true, data: video });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStats,
  getPendingProviders,
  approveProvider,
  rejectProvider,
  getUsers,
  suspendUser,
  deleteUser,
  getAllProviders,
  toggleVerified,
  getAllBookings,
  updateBookingStatus,
  getRevenue,
  getPendingCertificates,
  approveCertificate,
  rejectCertificate,
  getPendingPortfolioVideos,
  approvePortfolioVideo,
  rejectPortfolioVideo,
};
