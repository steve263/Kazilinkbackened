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

    const val = (r) => (r.status === 'fulfilled' ? r.value : null);

    const results = await Promise.allSettled([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { lt: weekAgo } } }),
      prisma.booking.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.booking.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.booking.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: monthStart } },
        _sum: { totalAmount: true },
      }),
      prisma.booking.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 1, 1), lt: monthStart },
        },
        _sum: { totalAmount: true },
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

    // Log any individual failures so we can see them in Railway logs
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`⚠️ getStats query[${i}] failed:`, r.reason?.message);
    });

    const totalUsers       = val(results[0])  ?? 0;
    const bookingsToday    = val(results[2])  ?? 0;
    const bookingsYesterday= val(results[3])  ?? 0;
    const revenueMonth     = val(results[4])  ?? { _sum: { totalAmount: null } };
    const revenueLastMonth = val(results[5])  ?? { _sum: { totalAmount: null } };
    const pendingProviders = val(results[6])  ?? 0;
    const activeBookings   = val(results[7])  ?? 0;
    const totalReviews     = val(results[8])  ?? 0;
    const reviewsLastWeek  = val(results[9])  ?? 0;
    const newUsersThisWeek = val(results[10]) ?? 0;
    const newUsersLastWeek = val(results[11]) ?? 0;

    const pct = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      success: true,
      data: {
        totalUsers:      { value: totalUsers,      change: pct(newUsersThisWeek, newUsersLastWeek) },
        bookingsToday:   { value: bookingsToday,   change: pct(bookingsToday, bookingsYesterday) },
        revenueThisMonth: {
          value: revenueMonth._sum?.totalAmount || 0,
          change: pct(revenueMonth._sum?.totalAmount || 0, revenueLastMonth._sum?.totalAmount || 0),
        },
        pendingProviders: { value: pendingProviders, change: 0 },
        activeBookings:   { value: activeBookings,   change: 0 },
        totalReviews:     { value: totalReviews,     change: pct(totalReviews - reviewsLastWeek, reviewsLastWeek) },
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
    const userId = req.params.id;
    console.log(`🗑️ Starting delete for user: ${userId}`);

    const provider = await prisma.provider.findUnique({ where: { userId } }).catch(() => null);

    // Step 1: Collect all booking IDs and delete their children
    const allBookingIds = [];

    if (provider) {
      const providerBookings = await prisma.booking.findMany({ where: { providerId: provider.id }, select: { id: true } });
      providerBookings.forEach((b) => allBookingIds.push(b.id));
    }

    const customerBookings = await prisma.booking.findMany({ where: { customerId: userId }, select: { id: true } });
    customerBookings.forEach((b) => allBookingIds.push(b.id));

    if (allBookingIds.length > 0) {
      await prisma.payment.deleteMany({ where: { bookingId: { in: allBookingIds } } }).catch(() => {});
      await prisma.review.deleteMany({ where: { bookingId: { in: allBookingIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { bookingId: { in: allBookingIds } } }).catch(() => {});
    }

    // Step 2: Delete bookings
    if (provider) {
      await prisma.booking.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
    }
    await prisma.booking.deleteMany({ where: { customerId: userId } }).catch(() => {});

    // Step 3: Delete provider records
    if (provider) {
      await prisma.service.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.review.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.providerWaitlist.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.portfolioVideo.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.promotion.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.verificationRequest.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.certificate.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.provider.delete({ where: { userId } }).catch(() => {});
    }

    // Step 4: Delete all other user-linked records
    await prisma.message.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.review.deleteMany({ where: { customerId: userId } }).catch(() => {});
    await prisma.report.deleteMany({ where: { OR: [{ reporterId: userId }, { reportedId: userId }] } }).catch(() => {});
    await prisma.fraudAlert.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.trustScore.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.suspensionAppeal.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.testimonial.deleteMany({ where: { customerId: userId } }).catch(() => {});
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { providerId: userId }] } }).catch(() => {});
    await prisma.reward.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.referral.deleteMany({ where: { OR: [{ referrerId: userId }, { referredId: userId }] } }).catch(() => {});
    await prisma.tipComment.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.tip.deleteMany({ where: { authorId: userId } }).catch(() => {});
    await prisma.videoComment.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.videoLike.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.videoReport.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.video.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.like.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.comment.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.providerWaitlist.deleteMany({ where: { customerId: userId } }).catch(() => {});
    await prisma.withdrawal.deleteMany({ where: { userId } }).catch(() => {});

    // Step 5: Delete the user
    await prisma.user.delete({ where: { id: userId } });

    console.log(`✅ User ${userId} deleted successfully`);
    res.json({ success: true, data: { message: 'User deleted successfully' } });
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

// ─── Bulk Actions ─────────────────────────────────────────────────────────────

async function bulkApproveProviders(req, res) {
  try {
    const { providerIds } = req.body;
    if (!Array.isArray(providerIds) || providerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'providerIds array required' });
    }

    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      include: { user: true },
    });

    await prisma.provider.updateMany({
      where: { id: { in: providerIds } },
      data: { verificationStatus: 'APPROVED', isVerified: true },
    });

    for (const p of providers) {
      smsSvc.sendSMS(p.user.phone, `Congratulations! Your KaziShow profile has been approved. You are now live on the platform.`).catch(console.error);
      prisma.notification.create({
        data: { userId: p.userId, type: 'SYSTEM', title: 'Profile Approved! 🎉', body: 'Your profile is now live on KaziShow.' },
      }).catch(console.error);
    }

    console.log(`✅ Bulk approved ${providers.length} providers`);
    res.json({ success: true, data: { approved: providers.length } });
  } catch (err) {
    console.error('❌ bulkApproveProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkRejectProviders(req, res) {
  try {
    const { providerIds, reason = 'Documents could not be verified' } = req.body;
    if (!Array.isArray(providerIds) || providerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'providerIds array required' });
    }

    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      include: { user: true },
    });

    await prisma.provider.updateMany({
      where: { id: { in: providerIds } },
      data: { verificationStatus: 'REJECTED', isVerified: false },
    });

    for (const p of providers) {
      smsSvc.sendSMS(p.user.phone, `Your KaziShow application was not approved. Reason: ${reason}. Please reapply with correct documents.`).catch(console.error);
    }

    console.log(`❌ Bulk rejected ${providers.length} providers`);
    res.json({ success: true, data: { rejected: providers.length } });
  } catch (err) {
    console.error('❌ bulkRejectProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

async function exportData(req, res) {
  try {
    const { type = 'bookings', dateFrom, dateTo } = req.query;
    const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;

    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.lte = new Date(new Date(dateTo).setHours(23, 59, 59));
    }

    let headers = [];
    let rows = [];

    if (type === 'bookings') {
      headers = ['ID', 'Customer', 'Phone', 'Provider', 'Service', 'Status', 'Payment Status', 'Amount (KSh)', 'Date'];
      const bookings = await prisma.booking.findMany({
        where: dateFilter,
        include: {
          customer: { select: { name: true, phone: true } },
          provider: { select: { businessName: true, category: true } },
          service: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      rows = bookings.map((b) => [
        b.id, b.customer?.name || '', b.customer?.phone || '',
        b.provider?.businessName || '', b.service?.name || '',
        b.status, b.paymentStatus || 'UNPAID', b.totalAmount || 0,
        new Date(b.createdAt).toLocaleDateString('en-KE'),
      ]);
    } else if (type === 'users') {
      headers = ['ID', 'Name', 'Phone', 'Role', 'Location', 'Active', 'Joined'];
      const users = await prisma.user.findMany({
        where: dateFilter,
        select: { id: true, name: true, phone: true, role: true, location: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      rows = users.map((u) => [u.id, u.name, u.phone, u.role, u.location || '', u.isActive ? 'Yes' : 'No', new Date(u.createdAt).toLocaleDateString('en-KE')]);
    } else if (type === 'payments') {
      headers = ['Booking ID', 'Customer', 'Provider', 'Amount (KSh)', 'Commission (KSh)', 'Provider Payout (KSh)', 'Payment Status', 'Date'];
      const where = { ...dateFilter, status: 'COMPLETED', totalAmount: { gt: 0 } };
      const bookings = await prisma.booking.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          provider: { select: { businessName: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      });
      rows = bookings.map((b) => [
        b.id, b.customer?.name || '', b.provider?.businessName || '',
        Math.round(b.totalAmount || 0),
        Math.round((b.totalAmount || 0) * COMMISSION_RATE),
        Math.round((b.totalAmount || 0) * (1 - COMMISSION_RATE)),
        b.paymentStatus || 'UNPAID',
        new Date(b.updatedAt).toLocaleDateString('en-KE'),
      ]);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type. Use: bookings, users, payments' });
    }

    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const filename = `kazishow-${type}-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('❌ exportData error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Announcement Broadcast ───────────────────────────────────────────────────

async function broadcastAnnouncement(req, res) {
  try {
    const { title, message, target } = req.body;
    const validTargets = ['ALL_CUSTOMERS', 'ALL_PROVIDERS', 'ALL_USERS'];
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'title and message are required' });
    }
    if (!validTargets.includes(target)) {
      return res.status(400).json({ success: false, message: `target must be one of: ${validTargets.join(', ')}` });
    }

    const userFilter = { isActive: true };
    if (target === 'ALL_CUSTOMERS') userFilter.role = 'CUSTOMER';
    else if (target === 'ALL_PROVIDERS') userFilter.role = 'PROVIDER';
    else userFilter.role = { not: 'ADMIN' };

    const users = await prisma.user.findMany({
      where: userFilter,
      select: { id: true, phone: true },
    });

    console.log(`📢 Broadcasting to ${users.length} users (${target}): "${title}"`);

    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: 'SYSTEM',
        title: title.trim(),
        body: message.trim(),
      })),
      skipDuplicates: true,
    });

    const phones = users.map((u) => u.phone).filter(Boolean);
    const BATCH = 50;
    for (let i = 0; i < phones.length; i += BATCH) {
      smsSvc.sendSMS(phones.slice(i, i + BATCH), `${title.trim()}: ${message.trim()}`).catch((e) =>
        console.error('❌ Broadcast SMS batch failed:', e.message)
      );
    }

    console.log(`✅ Broadcast complete: ${users.length} notifications, ${phones.length} SMS queued`);
    res.json({ success: true, data: { notificationsSent: users.length, smsSent: phones.length, target } });
  } catch (err) {
    console.error('❌ broadcastAnnouncement error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Auto-Suspension ──────────────────────────────────────────────────────────

async function getAutoSuspensionCandidates(req, res) {
  try {
    const DISPUTE_THRESHOLD = parseFloat(req.query.disputeThreshold) || 0.30;
    const INACTIVE_DAYS = parseInt(req.query.inactiveDays) || 30;

    const providers = await prisma.provider.findMany({
      where: { isVerified: true, user: { isActive: true } },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        bookings: {
          select: { status: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        },
        _count: { select: { bookings: true } },
      },
    });

    const candidates = [];

    for (const p of providers) {
      const reasons = [];
      const totalBookings = p._count.bookings;
      const disputed = p.bookings.filter((b) => b.status === 'DISPUTED').length;
      const disputeRate = totalBookings > 0 ? disputed / totalBookings : 0;

      const lastBooking = p.bookings[0];
      const daysSinceActivity = lastBooking
        ? Math.floor((Date.now() - new Date(lastBooking.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
        : INACTIVE_DAYS + 1;

      if (disputeRate >= DISPUTE_THRESHOLD && totalBookings >= 3) {
        reasons.push(`High dispute rate: ${Math.round(disputeRate * 100)}%`);
      }
      if (daysSinceActivity >= INACTIVE_DAYS) {
        reasons.push(`No activity for ${daysSinceActivity} days`);
      }

      if (reasons.length > 0) {
        candidates.push({
          id: p.id,
          businessName: p.businessName,
          category: p.category,
          userId: p.userId,
          userName: p.user.name,
          phone: p.user.phone,
          totalBookings,
          disputed,
          disputeRate: Math.round(disputeRate * 100),
          daysSinceActivity,
          reasons,
        });
      }
    }

    candidates.sort((a, b) => b.reasons.length - a.reasons.length || b.disputeRate - a.disputeRate);
    res.json({ success: true, data: candidates });
  } catch (err) {
    console.error('❌ getAutoSuspensionCandidates error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function runAutoSuspension(req, res) {
  try {
    const { providerIds, action = 'suspend' } = req.body;
    if (!Array.isArray(providerIds) || providerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'providerIds array required' });
    }

    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      include: { user: true },
    });

    if (action === 'suspend') {
      await prisma.user.updateMany({
        where: { id: { in: providers.map((p) => p.userId) } },
        data: { isActive: false },
      });
      for (const p of providers) {
        smsSvc.sendSMS(p.user.phone, `Your KaziShow account has been suspended due to policy violations. Contact support to appeal.`).catch(console.error);
        prisma.notification.create({
          data: { userId: p.userId, type: 'SYSTEM', title: 'Account Suspended', body: 'Your account has been suspended. Contact KaziShow support if you believe this is an error.' },
        }).catch(console.error);
      }
      console.log(`🚫 Auto-suspended ${providers.length} providers`);
    } else if (action === 'warn') {
      for (const p of providers) {
        smsSvc.sendSMS(p.user.phone, `KaziShow Warning: Your account has been flagged for review. Please improve your service quality to avoid suspension.`).catch(console.error);
        prisma.notification.create({
          data: { userId: p.userId, type: 'SYSTEM', title: 'Account Warning ⚠️', body: 'Your account has been flagged for review. Improve your service quality to avoid suspension.' },
        }).catch(console.error);
      }
      console.log(`⚠️ Warned ${providers.length} providers`);
    }

    res.json({ success: true, data: { action, affected: providers.length, providers: providers.map((p) => ({ id: p.id, businessName: p.businessName })) } });
  } catch (err) {
    console.error('❌ runAutoSuspension error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Global search ────────────────────────────────────────────────────────────

async function adminSearch(req, res) {
  try {
    const { q = '' } = req.query;
    const term = q.trim();
    if (!term || term.length < 2) {
      return res.json({ success: true, data: { users: [], providers: [], bookings: [] } });
    }

    const like = { contains: term, mode: 'insensitive' };

    const [users, providers, bookings] = await Promise.all([
      prisma.user.findMany({
        where: { OR: [{ name: like }, { email: like }, { phone: like }] },
        select: { id: true, name: true, email: true, phone: true, role: true, isSuspended: true },
        take: 6,
      }),
      prisma.provider.findMany({
        where: { OR: [{ businessName: like }, { category: like }] },
        select: { id: true, businessName: true, category: true, isVerified: true, user: { select: { name: true, phone: true } } },
        take: 6,
      }),
      prisma.booking.findMany({
        where: {
          OR: [
            { customer: { name: like } },
            { provider: { businessName: like } },
            { service: { name: like } },
            { id: { contains: term } },
          ],
        },
        select: {
          id: true, status: true, totalAmount: true,
          customer: { select: { name: true } },
          provider:  { select: { businessName: true } },
          service:   { select: { name: true } },
        },
        take: 6,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ success: true, data: { users, providers, bookings } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Sidebar badge counts ─────────────────────────────────────────────────────

async function adminBadges(req, res) {
  try {
    const [
      pendingProviders,
      pendingCerts,
      pendingVideos,
      pendingTestimonials,
      pendingTips,
      pendingWithdrawals,
      disputes,
      pendingAppeals,
      expiredSubs,
    ] = await Promise.all([
      prisma.provider.count({ where: { status: 'PENDING' } }),
      prisma.providerCertificate.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.portfolioVideo.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.testimonial.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.tip.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.booking.count({ where: { status: 'DISPUTED' } }),
      prisma.appeal.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.subscription.count({ where: { status: 'EXPIRED' } }).catch(() => 0),
    ]);

    res.json({
      success: true,
      data: {
        approvals: pendingProviders + pendingCerts + pendingVideos + pendingTestimonials + pendingTips,
        bookings:  disputes,
        withdrawals: pendingWithdrawals,
        appeals:   pendingAppeals,
        expiredSubs,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Subscription Management ──────────────────────────────────────────────────

async function getAdminSubscriptions(req, res) {
  try {
    const { status, plan, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (plan) where.plan = plan;
    if (search) {
      where.OR = [
        { provider: { businessName: { contains: search, mode: 'insensitive' } } },
        { provider: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { provider: { user: { phone: { contains: search } } } },
      ];
    }
    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          provider: { include: { user: { select: { name: true, phone: true, email: true } } } },
          payments: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.subscription.count({ where }),
    ]);
    res.json({ success: true, data: subscriptions, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAdminSubscriptionStats(req, res) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [totalTrial, totalActive, totalExpired, starterCount, growthCount, premiumCount, monthlyRevenue, totalRevenue] = await Promise.all([
      prisma.subscription.count({ where: { status: 'TRIAL' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'EXPIRED' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'STARTER' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'GROWTH' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'PREMIUM' } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
    ]);
    res.json({
      success: true,
      data: {
        totalTrial, totalActive, totalExpired,
        starterCount, growthCount, premiumCount,
        monthlyRevenue: monthlyRevenue._sum.amount || 0,
        totalRevenue: totalRevenue._sum.amount || 0,
        projectedRevenue: starterCount * 800 + growthCount * 1200 + premiumCount * 1500,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function waiveSubscription(req, res) {
  try {
    const { reason = 'Admin waiver', plan = 'STARTER' } = req.body;
    const validPlan = ['STARTER', 'GROWTH', 'PREMIUM'].includes(plan) ? plan : 'STARTER';
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    // Use raw SQL — Prisma ORM update casts to the enum type which may not exist in DB
    await prisma.$executeRawUnsafe(
      `UPDATE "Subscription" SET status = 'ACTIVE', plan = $1, "currentPeriodStart" = $2, "currentPeriodEnd" = $3, "updatedAt" = $4 WHERE id = $5`,
      validPlan, now, periodEnd, now, req.params.id
    );
    const sub = await prisma.subscription.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    console.log(`✅ Admin waived subscription for ${sub.provider.businessName} (${validPlan}) — reason: ${reason}`);
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function extendSubscription(req, res) {
  try {
    const { days = 30 } = req.body;
    const sub = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const base = sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date() ? new Date(sub.currentPeriodEnd) : new Date();
    const newEnd = new Date(base.getTime() + Number(days) * 24 * 60 * 60 * 1000);
    // Use raw SQL — Prisma ORM update casts to the enum type which may not exist in DB
    await prisma.$executeRawUnsafe(
      `UPDATE "Subscription" SET status = 'ACTIVE', "currentPeriodEnd" = $1, "updatedAt" = $2 WHERE id = $3`,
      newEnd, new Date(), req.params.id
    );
    const updated = await prisma.subscription.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });
    console.log(`✅ Admin extended subscription for ${updated.provider.businessName} by ${days} days → ${newEnd.toDateString()}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStats,
  getPendingProviders,
  approveProvider,
  rejectProvider,
  bulkApproveProviders,
  bulkRejectProviders,
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
  exportData,
  broadcastAnnouncement,
  getAutoSuspensionCandidates,
  runAutoSuspension,
  adminSearch,
  adminBadges,
  getAdminSubscriptions,
  getAdminSubscriptionStats,
  waiveSubscription,
  extendSubscription,
};
