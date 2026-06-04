const prisma = require('../config/db');
const smsSvc = require('../services/sms.service');
const emailSvc = require('../services/email.service');
const notificationSvc = require('../services/notification.service');
const firebaseSvc = require('../services/firebase.service');

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
      await prisma.outstandingCommission.deleteMany({ where: { bookingId: { in: allBookingIds } } }).catch(() => {});
    }

    // Delete commissions by provider too
    if (provider) {
      await prisma.outstandingCommission.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.subscription.deleteMany({ where: { providerId: provider.id } }).catch(() => {});
      await prisma.subscriptionPayment.deleteMany({ where: { subscription: { providerId: provider.id } } }).catch(() => {});
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
    const userExists = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (!userExists) {
      return res.json({ success: true, data: { message: 'User already deleted or not found' } });
    }
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

async function toggleBusy(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const updated = await prisma.provider.update({
      where: { id: req.params.id },
      data: {
        isBusy: !provider.isBusy,
        busySince: !provider.isBusy ? new Date() : null,
      },
    });

    console.log(`🔄 Admin toggled busy for ${provider.businessName}: ${updated.isBusy ? 'Busy' : 'Available'}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ toggleBusy error:', err.message);
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

async function updateBookingPaymentStatus(req, res) {
  try {
    const { paymentStatus } = req.body;
    const allowed = ['PAID', 'UNPAID', 'REFUNDED'];
    if (!allowed.includes(paymentStatus?.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Invalid payment status' });
    }
    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { paymentStatus: paymentStatus.toUpperCase() },
    });
    console.log(`💳 Admin updated payment status for booking ${req.params.id} → ${paymentStatus}`);
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
        disputes,
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
          payments: { orderBy: { createdAt: 'desc' }, take: 5 },
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

// ─── App Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  commissionRate: 10,
  cashCommissionRate: 10,
  trialDays: 14,
  starterPrice: 800,
  growthPrice: 1200,
  premiumPrice: 1500,
  maxBookingsPerDay: 10,
  autoCancelHours: 24,
  autoReleaseHours: 24,
  cancellationRefundHours: 2,
  maintenanceMode: false,
  newRegistrationsOpen: true,
  appName: 'KaziShow',
  supportPhone: '0795542312',
  supportEmail: 'kazishow0@gmail.com',
  whatsappNumber: '0795542312',
  smsEnabled: true,
  smsWelcomeMessage: "Welcome to KaziShow! Kenya's #1 service platform. Find and book trusted providers near you.",
  pushEnabled: true,
  emailEnabled: true,
  defaultCity: 'Nairobi',
  defaultCountry: 'Kenya',
  currency: 'KSh',
};

async function getSettings(req, res) {
  try {
    console.log('📖 Getting app settings...');
    const result = await prisma.$queryRawUnsafe(
      `SELECT settings FROM "AppSettings" LIMIT 1`
    );

    if (result && result.length > 0 && result[0].settings) {
      const parsed = JSON.parse(result[0].settings);
      console.log('✅ Settings loaded from database');
      return res.json({ success: true, data: { ...DEFAULT_SETTINGS, ...parsed } });
    }

    console.log('⚠️ No settings in DB — creating defaults');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AppSettings" ("id", "settings", "createdAt", "updatedAt")
       VALUES ('default-settings', $1, NOW(), NOW())
       ON CONFLICT ("id") DO NOTHING`,
      JSON.stringify(DEFAULT_SETTINGS)
    );

    res.json({ success: true, data: DEFAULT_SETTINGS });
  } catch (err) {
    console.error('❌ getSettings error:', err.message);
    res.json({ success: true, data: DEFAULT_SETTINGS });
  }
}

async function updateSettings(req, res) {
  try {
    const newSettings = req.body;
    console.log('💾 Saving settings:', Object.keys(newSettings));

    const settingsJson = JSON.stringify(newSettings);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AppSettings" ("id", "settings", "createdAt", "updatedAt")
       VALUES ('default-settings', $1, NOW(), NOW())
       ON CONFLICT ("id")
       DO UPDATE SET "settings" = $1, "updatedAt" = NOW()`,
      settingsJson
    );

    if (newSettings.commissionRate !== undefined) {
      process.env.COMMISSION_RATE = (newSettings.commissionRate / 100).toString();
      console.log(`✅ Commission rate updated to ${newSettings.commissionRate}%`);
    }

    console.log('✅ Settings saved to database successfully');
    res.json({ success: true, data: { message: 'Settings saved successfully' } });
  } catch (err) {
    console.error('❌ updateSettings error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save settings: ' + err.message });
  }
}

// ─── Verification Document Review ────────────────────────────────────────────

async function getVerificationRequests(req, res) {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const [requests, pending, approved, rejected] = await Promise.all([
      prisma.verificationRequest.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, name: true, phone: true, email: true,
              profilePhoto: true, createdAt: true,
              provider: {
                select: { id: true, businessName: true, category: true, isVerified: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.verificationRequest.count({ where: { status: 'APPROVED' } }),
      prisma.verificationRequest.count({ where: { status: 'REJECTED' } }),
    ]);

    res.json({ success: true, data: { requests, counts: { pending, approved, rejected } } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getVerificationDetail(req, res) {
  try {
    const request = await prisma.verificationRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          include: {
            provider: {
              include: {
                services: { take: 5 },
                _count: { select: { bookings: true, reviews: true } },
              },
            },
          },
        },
      },
    });
    if (!request) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approveVerification(req, res) {
  try {
    const request = await prisma.verificationRequest.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { provider: true } } },
    });
    if (!request) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.verificationRequest.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
    });

    const provider = request.user?.provider;
    if (provider) {
      await prisma.provider.update({
        where: { id: provider.id },
        data: { isVerified: true },
      });
    }

    notificationSvc.createNotification({
      userId: request.userId,
      type: 'SYSTEM',
      title: '✅ Verification Approved!',
      body: `Congratulations ${request.user.name}! Your KaziShow account has been verified. You now have a Verified badge on your profile.`,
    }).catch(console.error);

    smsSvc.sendSMS(
      request.user.phone,
      `KaziShow: Congratulations ${request.user.name}! Your account is now VERIFIED ✅. You have a verified badge on your profile. Customers can now find and book you with confidence!`
    ).catch(console.error);

    if (request.user.deviceToken) {
      firebaseSvc.sendPushNotification({
        deviceToken: request.user.deviceToken,
        title: '✅ Account Verified!',
        body: 'Your KaziShow account is now verified. You have a verified badge!',
        data: { url: '/provider/profile' },
      }).catch(console.error);
    }

    console.log(`✅ Verification approved: ${provider?.businessName || request.user.name}`);
    res.json({ success: true, data: { message: 'Provider verified successfully' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectVerification(req, res) {
  try {
    const { reason } = req.body;
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Please provide a rejection reason' });
    }

    const request = await prisma.verificationRequest.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { provider: true } } },
    });
    if (!request) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.verificationRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', adminNote: reason },
    });

    notificationSvc.createNotification({
      userId: request.userId,
      type: 'SYSTEM',
      title: '❌ Verification Rejected',
      body: `Your verification was not approved. Reason: ${reason}. Please resubmit with correct documents.`,
    }).catch(console.error);

    smsSvc.sendSMS(
      request.user.phone,
      `KaziShow: Your verification was not approved. Reason: ${reason}. Please open the app and resubmit your documents.`
    ).catch(console.error);

    console.log(`❌ Verification rejected: ${request.user?.provider?.businessName || request.user.name} — ${reason}`);
    res.json({ success: true, data: { message: 'Verification rejected' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Dispute Management ──────────────────────────────────────────────────────

async function getDisputes(req, res) {
  try {
    const { status } = req.query;
    const where = { status: status || 'DISPUTED' };

    const disputes = await prisma.booking.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, profilePhoto: true } },
        provider: { include: { user: { select: { id: true, name: true, phone: true, profilePhoto: true } } } },
        service:  { select: { name: true, price: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const disputesWithReports = await Promise.all(
      disputes.map(async (booking) => {
        const report = await prisma.report.findFirst({
          where: { bookingId: booking.id, type: 'JOB_DISPUTE' },
        }).catch(() => null);
        return { ...booking, disputeReport: report };
      })
    );

    const [totalDisputed, totalResolved] = await Promise.all([
      prisma.booking.count({ where: { status: 'DISPUTED' } }),
      prisma.booking.count({ where: { status: { in: ['COMPLETED', 'CANCELLED'] }, paymentReleasedAt: { not: null } } }),
    ]);

    res.json({ success: true, data: { disputes: disputesWithReports, stats: { totalDisputed, totalResolved } } });
  } catch (err) {
    console.error('getDisputes error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getDisputeDetail(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        provider: { include: { user: true } },
        service: true,
      },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const report = await prisma.report.findFirst({
      where: { bookingId: req.params.id, type: 'JOB_DISPUTE' },
    }).catch(() => null);

    res.json({ success: true, data: { ...booking, disputeReport: report } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function releaseToProvider(req, res) {
  try {
    const { notes } = req.body;
    const bookingId = req.params.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, provider: { include: { user: true } }, service: true },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
    const commission = Math.round(booking.totalAmount * commissionRate);
    const providerAmount = booking.totalAmount - commission;

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'COMPLETED', customerConfirmed: true, customerConfirmedAt: new Date(), paymentReleasedAt: new Date() },
    });

    await prisma.payment.updateMany({
      where: { bookingId },
      data: { status: 'PAID', providerAmount, commission },
    }).catch(() => {});

    const noteText = notes ? ` Note: ${notes}` : '';

    notificationSvc.createNotification({
      userId: booking.provider.userId,
      type: 'PAYMENT_RECEIVED',
      title: '💰 Payment Released by Admin!',
      body: `KaziShow admin resolved the dispute and released KSh ${providerAmount} to your earnings for ${booking.service?.name || 'Service'}.${noteText}`,
      bookingId,
    }).catch(console.error);

    notificationSvc.createNotification({
      userId: booking.customerId,
      type: 'SYSTEM',
      title: '⚖️ Dispute Resolved',
      body: `KaziShow admin reviewed your dispute and released payment to ${booking.provider.businessName}.${noteText}`,
      bookingId,
    }).catch(console.error);

    smsSvc.sendSMS(booking.provider.user.phone,
      `KaziShow: Dispute resolved! KSh ${providerAmount} has been released to your earnings. Thank you for your patience.`
    ).catch(console.error);

    smsSvc.sendSMS(booking.customer.phone,
      `KaziShow: Your dispute has been resolved. Payment was released to the provider after admin review.${noteText}`
    ).catch(console.error);

    console.log(`✅ Dispute resolved — released to provider: ${bookingId}`);
    res.json({ success: true, data: { message: `Payment of KSh ${providerAmount} released to provider` } });
  } catch (err) {
    console.error('releaseToProvider error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function refundToCustomer(req, res) {
  try {
    const { notes } = req.body;
    const bookingId = req.params.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, provider: { include: { user: true } }, service: true },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', paymentReleasedAt: new Date() },
    });

    await prisma.payment.updateMany({
      where: { bookingId },
      data: { status: 'REFUNDED' },
    }).catch(() => {});

    await prisma.bookingCancellation.upsert({
      where: { bookingId },
      create: {
        bookingId,
        cancelledBy: req.user.id,
        reason: `Admin dispute resolution: ${notes || 'Refund approved by admin'}`,
        refundAmount: booking.totalAmount,
        refundStatus: 'PENDING',
      },
      update: { refundAmount: booking.totalAmount, refundStatus: 'PENDING' },
    }).catch(() => {});

    const noteText = notes ? ` Note: ${notes}` : '';

    notificationSvc.createNotification({
      userId: booking.customerId,
      type: 'SYSTEM',
      title: '💰 Refund Approved!',
      body: `KaziShow admin approved a full refund of KSh ${booking.totalAmount}. You will receive the money via M-Pesa within 24 hours.${noteText}`,
      bookingId,
    }).catch(console.error);

    notificationSvc.createNotification({
      userId: booking.provider.userId,
      type: 'SYSTEM',
      title: '⚖️ Dispute Resolved — Refund Given',
      body: `KaziShow admin decided to refund the customer for ${booking.service?.name || 'Service'}.${noteText} Please ensure quality service in future.`,
      bookingId,
    }).catch(console.error);

    smsSvc.sendSMS(booking.customer.phone,
      `KaziShow: Dispute resolved! You will receive a full refund of KSh ${booking.totalAmount} via M-Pesa within 24 hours. Thank you for your patience.`
    ).catch(console.error);

    smsSvc.sendSMS(booking.provider.user.phone,
      `KaziShow: Dispute resolved. Customer has been refunded KSh ${booking.totalAmount}. Please maintain quality service standards.`
    ).catch(console.error);

    console.log(`✅ Dispute resolved — refunded to customer: ${bookingId}`);
    res.json({ success: true, data: { message: `Full refund of KSh ${booking.totalAmount} approved for customer` } });
  } catch (err) {
    console.error('refundToCustomer error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN COMMISSION MANAGEMENT ───────────────────────────────────────────────

async function getAllCommissions(req, res) {
  try {
    const { status } = req.query;
    console.log('Getting commissions, status filter:', status);

    const where = {};
    if (status && status !== 'ALL') where.status = status;

    const commissions = await prisma.outstandingCommission.findMany({
      where,
      include: {
        provider: {
          include: {
            user: { select: { id: true, name: true, phone: true, profilePhoto: true, isSuspended: true } },
          },
        },
        booking: {
          include: {
            customer: { select: { name: true, phone: true } },
            service:  { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`Found ${commissions.length} commissions`);

    const [pending, pendingVerification, paid, overdue] = await Promise.all([
      prisma.outstandingCommission.count({ where: { status: 'PENDING' } }),
      prisma.outstandingCommission.count({ where: { status: 'PENDING_VERIFICATION' } }),
      prisma.outstandingCommission.count({ where: { status: 'PAID' } }),
      prisma.outstandingCommission.count({ where: { status: 'OVERDUE' } }),
    ]);

    const [totalPending, totalCollected] = await Promise.all([
      prisma.outstandingCommission.aggregate({
        where: { status: { in: ['PENDING', 'PENDING_VERIFICATION', 'OVERDUE'] } },
        _sum: { commissionAmount: true },
      }),
      prisma.outstandingCommission.aggregate({
        where: { status: 'PAID' },
        _sum: { commissionAmount: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        commissions,
        stats: {
          pending,
          pendingVerification,
          paid,
          overdue,
          totalPendingAmount:   totalPending._sum.commissionAmount   || 0,
          totalCollectedAmount: totalCollected._sum.commissionAmount || 0,
        },
      },
    });
  } catch (err) {
    console.error('getAllCommissions error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function confirmCommission(req, res) {
  try {
    const commission = await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'PAID', paidAt: new Date() },
      include: {
        provider: { include: { user: true } },
        booking:  { include: { service: true } },
      },
    });

    // Unsuspend provider if they were suspended
    await prisma.user.update({
      where: { id: commission.provider.userId },
      data: { isSuspended: false },
    }).catch(() => {});

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '✅ Commission Confirmed!',
      body: `Your commission of KSh ${commission.commissionAmount} for ${commission.booking?.service?.name || 'Service'} has been confirmed. Your account is fully active!`,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: ✅ Commission of KSh ${commission.commissionAmount} confirmed! Your account is fully active. Keep getting bookings on kazishow.co.ke`
    ).catch(console.error);

    res.json({ success: true, data: { message: 'Commission confirmed. Fundi notified.' } });
  } catch (err) {
    console.error('confirmCommission error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectCommission(req, res) {
  try {
    const { reason } = req.body;

    const commission = await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'PENDING', mpesaRef: null },
      include: { provider: { include: { user: true } } },
    });

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '❌ Commission Code Rejected',
      body: `Your M-Pesa code was not verified. ${reason || 'Please pay again and submit the correct M-Pesa SMS message.'}`,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: ❌ Commission payment rejected. ${reason || 'Please pay KSh ' + commission.commissionAmount + ' to Paybill 247247 Account 0795542312 and submit the M-Pesa SMS again.'}`
    ).catch(console.error);

    res.json({ success: true, data: { message: 'Rejected. Fundi notified to pay again.' } });
  } catch (err) {
    console.error('rejectCommission error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function waiveCommission(req, res) {
  try {
    const commission = await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'WAIVED', paidAt: new Date() },
      include: { provider: { include: { user: true } } },
    });

    await prisma.user.update({
      where: { id: commission.provider.userId },
      data: { isSuspended: false },
    }).catch(() => {});

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '🎁 Commission Waived!',
      body: `Your commission of KSh ${commission.commissionAmount} has been waived by KaziShow admin. Your account is fully active!`,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: 🎁 Your commission of KSh ${commission.commissionAmount} has been waived! Account fully active. Keep getting bookings!`
    ).catch(console.error);

    res.json({ success: true, data: { message: 'Commission waived. Fundi notified.' } });
  } catch (err) {
    console.error('waiveCommission error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function suspendForCommission(req, res) {
  try {
    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });
    if (!commission) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.user.update({
      where: { id: commission.provider.userId },
      data: { isSuspended: true },
    });

    await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'OVERDUE' },
    });

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '🚨 Account Suspended!',
      body: `Your account has been suspended due to unpaid commission of KSh ${commission.commissionAmount}. Pay via Paybill 247247 Account 0795542312 and contact support on 0795542312.`,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: 🚨 SUSPENDED! Unpaid commission of KSh ${commission.commissionAmount}. Pay via M-Pesa Paybill 247247 Account 0795542312 then WhatsApp 0795542312 to reactivate.`
    ).catch(console.error);

    res.json({ success: true, data: { message: 'Provider suspended. They have been notified.' } });
  } catch (err) {
    console.error('suspendForCommission error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Admin Analytics (single combined endpoint) ──────────────────────────────
async function getAnalytics(req, res) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let rangeStart, rangeEnd;
    if (req.query.startDate && req.query.endDate) {
      rangeStart = new Date(req.query.startDate + 'T00:00:00.000Z');
      rangeEnd = new Date(req.query.endDate + 'T23:59:59.999Z');
    } else {
      const days = parseInt(req.query.period) || 30;
      rangeEnd = now;
      rangeStart = new Date(now);
      rangeStart.setDate(rangeStart.getDate() - days);
    }

    const startISO = rangeStart.toISOString();
    const endISO = rangeEnd.toISOString();

    const [
      totalBookings,
      completedBookings,
      totalUsersRaw,
      totalProviders,
      verifiedProviders,
      totalReviews,
      avgRatingRaw,
      activeToday,
    ] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.user.groupBy({ by: ['role'], _count: true }),
      prisma.provider.count(),
      prisma.provider.count({ where: { isVerified: true } }),
      prisma.review.count(),
      prisma.review.aggregate({ _avg: { rating: true } }),
      prisma.booking.count({ where: { status: { in: ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'] } } }),
    ]);

    const customerCount = totalUsersRaw.find(u => u.role === 'CUSTOMER')?._count || 0;

    const [revenueAllTime, revenueThisMonth, commissionCollected, subscriptionRevenue, bookingsThisMonth, newCustomersThisMonth] = await Promise.all([
      prisma.booking.aggregate({ where: { status: 'COMPLETED' }, _sum: { totalAmount: true } }),
      prisma.booking.aggregate({ where: { status: 'COMPLETED', updatedAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      prisma.outstandingCommission.aggregate({ where: { status: 'PAID' }, _sum: { commissionAmount: true } }).catch(() => ({ _sum: { commissionAmount: 0 } })),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.booking.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: monthStart } } }),
    ]);

    const completionRate = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;

    // Daily chart data
    const dailyBookings = await prisma.$queryRawUnsafe(`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) as bookings,
        COALESCE(SUM("totalAmount"), 0) as revenue
      FROM "Booking"
      WHERE "createdAt" >= '${startISO}' AND "createdAt" <= '${endISO}'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `);

    // Category breakdown
    const categoryBookings = await prisma.$queryRawUnsafe(`
      SELECT
        p.category,
        COUNT(b.id) as bookings,
        COALESCE(SUM(b."totalAmount"), 0) as revenue
      FROM "Provider" p
      LEFT JOIN "Booking" b ON b."providerId" = p.id
      GROUP BY p.category
      ORDER BY bookings DESC
    `);

    // Status breakdown
    const statusBreakdown = await prisma.booking.groupBy({ by: ['status'], _count: true });

    // Top providers
    const topProviders = await prisma.provider.findMany({
      take: 10,
      include: {
        user: { select: { name: true, profilePhoto: true } },
        _count: { select: { bookings: true, reviews: true } },
        bookings: { where: { status: 'COMPLETED' }, select: { totalAmount: true } },
        reviews: { select: { rating: true } },
      },
      orderBy: { bookings: { _count: 'desc' } },
    });

    const topProvidersFormatted = topProviders.map(p => ({
      id: p.id,
      name: p.businessName,
      category: p.category,
      location: p.location,
      profilePhoto: p.profilePhoto || p.user?.profilePhoto,
      totalBookings: p._count.bookings,
      totalRevenue: p.bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
      averageRating: p.reviews.length > 0
        ? parseFloat((p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length).toFixed(1))
        : 0,
      totalReviews: p._count.reviews,
    }));

    // Growth data (6 months)
    const growthData = await prisma.$queryRawUnsafe(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon') as month,
        DATE_TRUNC('month', "createdAt") as month_date,
        COUNT(CASE WHEN role = 'CUSTOMER' THEN 1 END) as customers,
        COUNT(CASE WHEN role = 'PROVIDER' THEN 1 END) as providers
      FROM "User"
      WHERE "createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', "createdAt"), TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon')
      ORDER BY month_date ASC
    `);

    const bookingGrowth = await prisma.$queryRawUnsafe(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon') as month,
        COUNT(*) as bookings
      FROM "Booking"
      WHERE "createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `);

    // Recent activity
    const [recentBookings, newUsers, recentPayments] = await Promise.all([
      prisma.booking.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          provider: { select: { businessName: true, category: true } },
        },
      }),
      prisma.user.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, role: true, createdAt: true, location: true },
      }),
      prisma.booking.findMany({
        take: 5, where: { status: 'COMPLETED' }, orderBy: { updatedAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          provider: { select: { businessName: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalRevenue: revenueAllTime._sum.totalAmount || 0,
        revenueThisMonth: revenueThisMonth._sum.totalAmount || 0,
        totalBookings,
        bookingsThisMonth,
        completedBookings,
        completionRate,
        totalCustomers: customerCount,
        newCustomersThisMonth,
        totalProviders,
        verifiedProviders,
        activeToday,
        averageRating: parseFloat((avgRatingRaw._avg.rating || 0).toFixed(1)),
        totalReviews,
        commissionRevenue: commissionCollected._sum.commissionAmount || 0,
        subscriptionRevenue: subscriptionRevenue._sum.amount || 0,
        dailyBookings: dailyBookings.map(d => ({
          date: new Date(d.date).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
          bookings: Number(d.bookings),
          revenue: parseFloat(d.revenue),
        })),
        categoryBreakdown: categoryBookings.map(c => ({
          category: c.category,
          bookings: Number(c.bookings),
          revenue: parseFloat(c.revenue),
        })),
        statusBreakdown: statusBreakdown.map(s => ({ status: s.status, count: s._count })),
        growthData: growthData.map(g => ({
          month: g.month,
          customers: Number(g.customers),
          providers: Number(g.providers),
          bookings: Number(bookingGrowth.find(b => b.month === g.month)?.bookings || 0),
        })),
        topProviders: topProvidersFormatted,
        recentBookings,
        newUsers,
        recentPayments: recentPayments.map(b => ({
          id: b.id,
          amount: b.totalAmount,
          customer: b.customer,
          provider: b.provider,
        })),
      },
    });
  } catch (err) {
    console.error('getAnalytics error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Finance Data ─────────────────────────────────────────────────────────────
async function getFinanceData(req, res) {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalCommission, totalSubscription,
      thisMonthCommission, thisMonthSubscription,
      lastMonthCommission, lastMonthSubscription,
      todayCommission, todaySubscription,
      pendingCommission, pendingSubscription,
      totalBookingValue, thisMonthBookingValue,
    ] = await Promise.all([
      prisma.outstandingCommission.aggregate({ where: { status: 'PAID' }, _sum: { commissionAmount: true } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.outstandingCommission.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { commissionAmount: true } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.outstandingCommission.aggregate({ where: { status: 'PAID', paidAt: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { commissionAmount: true } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID', paidAt: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.outstandingCommission.aggregate({ where: { status: 'PAID', paidAt: { gte: todayStart } }, _sum: { commissionAmount: true } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PAID', paidAt: { gte: todayStart } }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.outstandingCommission.aggregate({ where: { status: { in: ['PENDING', 'PENDING_VERIFICATION', 'OVERDUE'] } }, _sum: { commissionAmount: true } }),
      prisma.subscriptionPayment.aggregate({ where: { status: 'PENDING_VERIFICATION' }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } })),
      prisma.booking.aggregate({ where: { status: 'COMPLETED' }, _sum: { totalAmount: true } }),
      prisma.booking.aggregate({ where: { status: 'COMPLETED', updatedAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
    ]);

    const dailyData = await prisma.$queryRawUnsafe(`
      SELECT DATE(oc."paidAt") as date, COUNT(*) as transactions, COALESCE(SUM(oc."commissionAmount"), 0) as commission
      FROM "OutstandingCommission" oc
      WHERE oc.status = 'PAID' AND oc."paidAt" >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(oc."paidAt") ORDER BY date DESC
    `);

    const dailySubData = await prisma.$queryRawUnsafe(`
      SELECT DATE(sp."paidAt") as date, COUNT(*) as transactions, COALESCE(SUM(sp.amount), 0) as subscription
      FROM "SubscriptionPayment" sp
      WHERE sp.status = 'PAID' AND sp."paidAt" >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(sp."paidAt") ORDER BY date DESC
    `).catch(() => []);

    const monthlyData = await prisma.$queryRawUnsafe(`
      SELECT TO_CHAR(DATE_TRUNC('month', oc."paidAt"), 'Mon YYYY') as month,
             DATE_TRUNC('month', oc."paidAt") as month_date,
             COUNT(*) as transactions,
             COALESCE(SUM(oc."commissionAmount"), 0) as commission
      FROM "OutstandingCommission" oc
      WHERE oc.status = 'PAID' AND oc."paidAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', oc."paidAt"), TO_CHAR(DATE_TRUNC('month', oc."paidAt"), 'Mon YYYY')
      ORDER BY month_date DESC
    `);

    const monthlySubData = await prisma.$queryRawUnsafe(`
      SELECT TO_CHAR(DATE_TRUNC('month', sp."paidAt"), 'Mon YYYY') as month,
             DATE_TRUNC('month', sp."paidAt") as month_date,
             COALESCE(SUM(sp.amount), 0) as subscription
      FROM "SubscriptionPayment" sp
      WHERE sp.status = 'PAID' AND sp."paidAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', sp."paidAt"), TO_CHAR(DATE_TRUNC('month', sp."paidAt"), 'Mon YYYY')
      ORDER BY month_date DESC
    `).catch(() => []);

    const recentCommissions = await prisma.outstandingCommission.findMany({
      where: { status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      take: 20,
      include: {
        provider: { include: { user: { select: { name: true, phone: true } } } },
        booking: { include: { service: { select: { name: true } }, customer: { select: { name: true } } } },
      },
    });

    const recentSubscriptions = await prisma.subscriptionPayment.findMany({
      where: { status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      take: 20,
      include: {
        subscription: {
          include: { provider: { include: { user: { select: { name: true, phone: true } } } } },
        },
      },
    }).catch(() => []);

    const topCommissionEarners = await prisma.outstandingCommission.groupBy({
      by: ['providerId'],
      where: { status: 'PAID' },
      _sum: { commissionAmount: true },
      _count: true,
      orderBy: { _sum: { commissionAmount: 'desc' } },
      take: 5,
    });

    const topEarners = await Promise.all(
      topCommissionEarners.map(async (e) => {
        const provider = await prisma.provider.findUnique({
          where: { id: e.providerId },
          include: { user: { select: { name: true, phone: true } } },
        });
        return { ...e, provider };
      })
    );

    const thisMonthTotal = (thisMonthCommission._sum.commissionAmount || 0) + (thisMonthSubscription._sum.amount || 0);
    const lastMonthTotal = (lastMonthCommission._sum.commissionAmount || 0) + (lastMonthSubscription._sum.amount || 0);
    const monthlyGrowth = lastMonthTotal > 0 ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalCommission: totalCommission._sum.commissionAmount || 0,
          totalSubscription: totalSubscription._sum.amount || 0,
          totalRevenue: (totalCommission._sum.commissionAmount || 0) + (totalSubscription._sum.amount || 0),
          totalBookingValue: totalBookingValue._sum.totalAmount || 0,
          thisMonthCommission: thisMonthCommission._sum.commissionAmount || 0,
          thisMonthSubscription: thisMonthSubscription._sum.amount || 0,
          thisMonthTotal,
          thisMonthBookingValue: thisMonthBookingValue._sum.totalAmount || 0,
          lastMonthCommission: lastMonthCommission._sum.commissionAmount || 0,
          lastMonthSubscription: lastMonthSubscription._sum.amount || 0,
          lastMonthTotal,
          todayCommission: todayCommission._sum.commissionAmount || 0,
          todaySubscription: todaySubscription._sum.amount || 0,
          todayTotal: (todayCommission._sum.commissionAmount || 0) + (todaySubscription._sum.amount || 0),
          pendingCommission: pendingCommission._sum.commissionAmount || 0,
          pendingSubscription: pendingSubscription._sum.amount || 0,
          pendingTotal: (pendingCommission._sum.commissionAmount || 0) + (pendingSubscription._sum.amount || 0),
          monthlyGrowth,
        },
        dailyData,
        dailySubData,
        monthlyData,
        monthlySubData,
        recentCommissions,
        recentSubscriptions,
        topEarners,
      },
    });
  } catch (err) {
    console.error('getFinanceData error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Provider Schedule ────────────────────────────────────────────────────────

async function getSchedule(req, res) {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        scheduledDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'PREPARING', 'READY'] },
      },
      include: {
        provider: {
          include: {
            user: { select: { name: true, phone: true, email: true } },
          },
        },
        customer: { select: { name: true, phone: true } },
        service:  { select: { name: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    const providerMap = {};
    for (const booking of bookings) {
      const pid = booking.providerId;
      if (!providerMap[pid]) {
        providerMap[pid] = { provider: booking.provider, bookings: [] };
      }
      providerMap[pid].bookings.push(booking);
    }
    const providers = Object.values(providerMap);

    res.json({
      success: true,
      data: {
        date: targetDate,
        totalBookings: bookings.length,
        totalProviders: providers.length,
        providers,
      },
    });
  } catch (err) {
    console.error('getSchedule error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function sendReminder(req, res) {
  try {
    const { providerPhone, message, method } = req.body;
    if (!providerPhone || !message) {
      return res.status(400).json({ success: false, message: 'providerPhone and message are required' });
    }
    if (method === 'sms') {
      await smsSvc.sendSMS(providerPhone, message);
    }
    console.log(`✅ Schedule reminder sent to ${providerPhone} via ${method}`);
    res.json({ success: true, message: 'Reminder sent' });
  } catch (err) {
    console.error('sendReminder error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function exportFinanceData(req, res) {
  try {
    const { period = 'month' } = req.query;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dateFilter = period === 'month' ? { gte: monthStart } : undefined;

    const commissions = await prisma.outstandingCommission.findMany({
      where: { status: 'PAID', ...(dateFilter ? { paidAt: dateFilter } : {}) },
      orderBy: { paidAt: 'desc' },
      include: {
        provider: { include: { user: { select: { name: true, phone: true } } } },
        booking: { include: { service: { select: { name: true } }, customer: { select: { name: true } } } },
      },
    });

    const subscriptions = await prisma.subscriptionPayment.findMany({
      where: { status: 'PAID', ...(dateFilter ? { paidAt: dateFilter } : {}) },
      orderBy: { paidAt: 'desc' },
      include: {
        subscription: {
          include: { provider: { include: { user: { select: { name: true, phone: true } } } } },
        },
      },
    }).catch(() => []);

    const rows = [
      ['Date', 'Type', 'Provider Name', 'Phone', 'Service', 'Customer', 'Job Amount (KSh)', 'KaziShow Earned (KSh)', 'M-Pesa Reference'].join(','),
    ];

    commissions.forEach(c => {
      rows.push([
        c.paidAt ? new Date(c.paidAt).toLocaleDateString('en-KE') : '',
        'Commission (10%)',
        c.provider?.businessName || '',
        c.provider?.user?.phone || '',
        c.booking?.service?.name || '',
        c.booking?.customer?.name || '',
        c.cashAmount || 0,
        c.commissionAmount || 0,
        `"${(c.mpesaRef || '').replace(/"/g, "'")}"`,
      ].join(','));
    });

    subscriptions.forEach(s => {
      rows.push([
        s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-KE') : '',
        `Subscription (${s.subscription?.plan || ''})`,
        s.subscription?.provider?.businessName || '',
        s.subscription?.provider?.user?.phone || '',
        '', '', '',
        s.amount || 0,
        `"${(s.mpesaRef || '').replace(/"/g, "'")}"`,
      ].join(','));
    });

    const filename = `kazishow-finance-${period}-${now.toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\n'));
  } catch (err) {
    console.error('exportFinanceData error:', err.message);
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
  toggleBusy,
  getAllBookings,
  updateBookingStatus,
  updateBookingPaymentStatus,
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
  getVerificationRequests,
  getVerificationDetail,
  approveVerification,
  rejectVerification,
  getSettings,
  updateSettings,
  getDisputes,
  getDisputeDetail,
  releaseToProvider,
  refundToCustomer,
  getAllCommissions,
  confirmCommission,
  rejectCommission,
  waiveCommission,
  suspendForCommission,
  getAnalytics,
  getFinanceData,
  exportFinanceData,
  getSchedule,
  sendReminder,
  verifyJobPayment,
  rejectJobPayment,
  getJobApplications,
};

// ─── Job Application Payment Verification ─────────────────────────────────────

async function verifyJobPayment(req, res) {
  try {
    const { appId } = req.params;

    const application = await prisma.jobApplication.update({
      where: { id: appId },
      data: { paymentStatus: 'PAYMENT_VERIFIED' },
      include: {
        job: {
          include: {
            employer: {
              include: { employerProfile: true },
            },
          },
        },
      },
    });

    // Notify employer to review applicant
    if (application.job?.employer?.id) {
      notificationSvc.createNotification({
        userId: application.job.employer.id,
        type: 'SYSTEM',
        title: '👤 New Applicant Ready',
        body: `${application.applicantName} has applied for "${application.job.title}". Payment verified. Review and hire or reject them.`,
      }).catch(console.error);

      const employerPhone = application.job.employer.employerProfile?.phone;
      if (employerPhone) {
        smsSvc.sendSMS(
          employerPhone,
          `New verified applicant for your KaziShow job "${application.job.title}"! ${application.applicantName} (${application.applicantPhone}) has applied. Login to review and hire them. kazishow.co.ke`
        ).catch(console.error);
      }
    }

    // SMS to applicant
    if (application.applicantPhone) {
      smsSvc.sendSMS(
        application.applicantPhone,
        `Your payment for "${application.job?.title}" has been verified by KaziShow! The employer will review your application and contact you soon. kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Payment verified. Employer notified.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectJobPayment(req, res) {
  try {
    const { appId } = req.params;
    const { reason } = req.body;

    const application = await prisma.jobApplication.update({
      where: { id: appId },
      data: {
        paymentStatus: 'REJECTED',
        status: 'DECLINED',
        employerNote: reason || 'Payment not found',
      },
    });

    if (application.applicantPhone) {
      smsSvc.sendSMS(
        application.applicantPhone,
        `Your application payment for this KaziShow job could not be verified. Please ensure you pay to Paybill 247247 and paste the correct M-Pesa SMS. Contact support if you need help. kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Payment rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getJobApplications(req, res) {
  try {
    const applications = await prisma.jobApplication.findMany({
      include: {
        job: {
          select: {
            title: true,
            location: true,
            pay: true,
            employer: {
              select: {
                id: true,
                name: true,
                employerProfile: { select: { phone: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: applications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
