const prisma = require('../config/db');
const notificationSvc = require('../services/notification.service');
const smsSvc = require('../services/sms.service');

async function getProfile(req, res) {
  try {
    const [user, reviewCount, savedCount, tipCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true, name: true, phone: true, email: true, role: true,
          location: true, lat: true, lng: true, profilePhoto: true, createdAt: true,
          _count: { select: { bookingsAsCustomer: true } },
        },
      }),
      prisma.review.count({ where: { customerId: req.user.id } }),
      prisma.follow.count({ where: { followerId: req.user.id } }),
      prisma.tip.count({ where: { authorId: req.user.id } }),
    ]);
    res.json({ success: true, data: { ...user, reviewCount, savedCount, tipCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const { name, email, location, lat, lng, profilePhoto } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase().trim() }),
        ...(location && { location }),
        ...(lat && { lat: parseFloat(lat) }),
        ...(lng && { lng: parseFloat(lng) }),
        ...(profilePhoto && { profilePhoto }),
      },
      select: { id: true, name: true, phone: true, email: true, location: true, profilePhoto: true },
    });
    console.log(`✏️ Customer profile updated: ${updated.name}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createReview(req, res) {
  try {
    const { bookingId, rating, comment } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({ success: false, message: 'bookingId and rating are required' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }
    if (!comment || comment.trim().length < 20) {
      return res.status(400).json({ success: false, message: 'Comment must be at least 20 characters' });
    }
    if (comment.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Comment must be at most 500 characters' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        review: true,
        provider: { include: { user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only review your own bookings' });
    }
    if (booking.status !== 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'You can only review completed bookings' });
    }
    if (booking.review) {
      return res.status(409).json({ success: false, message: 'You have already reviewed this booking' });
    }

    const review = await prisma.$transaction(async (tx) => {
      const rev = await tx.review.create({
        data: {
          bookingId,
          customerId: req.user.id,
          providerId: booking.providerId,
          rating: parseInt(rating),
          comment: comment.trim(),
        },
      });

      const agg = await tx.review.aggregate({
        where: { providerId: booking.providerId },
        _avg: { rating: true },
        _count: true,
      });

      await tx.provider.update({
        where: { id: booking.providerId },
        data: {
          rating: Math.round((agg._avg.rating || 0) * 10) / 10,
          totalReviews: agg._count,
        },
      });

      return rev;
    });

    // Notify provider (fire-and-forget)
    const providerUserId = booking.provider?.user?.id;
    const providerPhone = booking.provider?.user?.phone;
    const customerName = req.user.name;

    if (providerUserId) {
      notificationSvc.createNotification({
        userId: providerUserId,
        type: 'SYSTEM',
        title: `⭐ New ${rating}-star review!`,
        body: `${customerName} gave you a ${rating} star review. Check your profile.`,
        bookingId,
      }).catch(console.error);
    }

    if (providerPhone) {
      smsSvc.sendSMS(
        providerPhone,
        `KaziShow: New review from ${customerName} — ${rating} stars. Check your profile on the app.`
      ).catch(console.error);
    }

    console.log(`⭐ Review created for booking ${bookingId} — ${rating} stars by ${customerName}`);
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    console.error('❌ createReview error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getProviderReviews(req, res) {
  try {
    const { page = 1, limit = 20, sort = 'recent' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const providerId = req.params.providerId || req.params.id;

    const orderBy =
      sort === 'highest' ? { rating: 'desc' }
      : sort === 'lowest' ? { rating: 'asc' }
      : { createdAt: 'desc' };

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { providerId },
        include: {
          customer: { select: { id: true, name: true, profilePhoto: true } },
          booking: { select: { id: true, service: { select: { name: true } } } },
        },
        orderBy,
        skip,
        take: parseInt(limit),
      }),
      prisma.review.count({ where: { providerId } }),
    ]);

    // Real star distribution
    const distribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { providerId },
      _count: true,
    });

    const starBreakdown = [5, 4, 3, 2, 1].map((star) => {
      const found = distribution.find((d) => d.rating === star);
      const count = found ? found._count : 0;
      return { star, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
    });

    res.json({
      success: true,
      data: {
        reviews,
        starBreakdown,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyReviews(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { customerId: req.user.id },
        include: {
          provider: {
            select: {
              id: true,
              businessName: true,
              category: true,
              profileImage: true,
            },
          },
          booking: { select: { id: true, service: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.review.count({ where: { customerId: req.user.id } }),
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateReview(req, res) {
  try {
    const { rating, comment } = req.body;
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });

    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    if (review.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only edit your own reviews' });
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(review.createdAt).getTime() > sevenDaysMs) {
      return res.status(400).json({ success: false, message: 'Reviews can only be edited within 7 days of posting' });
    }

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
      }
    }
    if (comment !== undefined) {
      if (comment.trim().length < 20) {
        return res.status(400).json({ success: false, message: 'Comment must be at least 20 characters' });
      }
      if (comment.trim().length > 500) {
        return res.status(400).json({ success: false, message: 'Comment must be at most 500 characters' });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const rev = await tx.review.update({
        where: { id: req.params.id },
        data: {
          ...(rating !== undefined && { rating: parseInt(rating) }),
          ...(comment !== undefined && { comment: comment.trim() }),
        },
      });

      const agg = await tx.review.aggregate({
        where: { providerId: review.providerId },
        _avg: { rating: true },
        _count: true,
      });

      await tx.provider.update({
        where: { id: review.providerId },
        data: {
          rating: Math.round((agg._avg.rating || 0) * 10) / 10,
          totalReviews: agg._count,
        },
      });

      return rev;
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteReview(req, res) {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });

    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    if (review.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only delete your own reviews' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: req.params.id } });

      const agg = await tx.review.aggregate({
        where: { providerId: review.providerId },
        _avg: { rating: true },
        _count: true,
      });

      await tx.provider.update({
        where: { id: review.providerId },
        data: {
          rating: Math.round((agg._avg.rating || 0) * 10) / 10,
          totalReviews: agg._count,
        },
      });
    });

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markHelpful(req, res) {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    const updated = await prisma.review.update({
      where: { id: req.params.id },
      data: { helpfulCount: { increment: 1 } },
    });

    res.json({ success: true, data: { helpfulCount: updated.helpfulCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getReviewableBooking(req, res) {
  try {
    const providerId = req.params.providerId;
    const booking = await prisma.booking.findFirst({
      where: {
        customerId: req.user.id,
        providerId,
        status: 'COMPLETED',
        review: null,
      },
      select: { id: true },
    });
    res.json({ success: true, data: booking ? { bookingId: booking.id } : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getSavedProviders(req, res) {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      include: {
        provider: {
          include: {
            user: { select: { id: true, name: true, isOnline: true, location: true } },
            services: { where: { isActive: true }, take: 3 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: follows.map((f) => f.provider) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function saveProvider(req, res) {
  try {
    const providerId = req.params.id;
    const existing = await prisma.follow.findUnique({
      where: { followerId_providerId: { followerId: req.user.id, providerId } },
    });
    if (existing) return res.status(409).json({ success: false, message: 'Already saved' });
    await prisma.follow.create({ data: { followerId: req.user.id, providerId } });
    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function removeSavedProvider(req, res) {
  try {
    await prisma.follow.deleteMany({ where: { followerId: req.user.id, providerId: req.params.id } });
    res.json({ success: true, data: { removed: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getProfile, updateProfile,
  createReview, getProviderReviews, getMyReviews,
  updateReview, deleteReview, markHelpful,
  getReviewableBooking,
  getSavedProviders, saveProvider, removeSavedProvider,
};
