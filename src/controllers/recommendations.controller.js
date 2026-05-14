const prisma = require('../config/db');

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getRecommendations(req, res) {
  try {
    const userId = req.user.id;

    // 1. Previously booked providers (Book Again)
    const previousBookings = await prisma.booking.findMany({
      where: { customerId: userId, status: 'COMPLETED' },
      include: {
        provider: { include: { user: { select: { location: true } } } },
        service: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const seenProviders = new Set();
    const bookAgain = [];
    for (const b of previousBookings) {
      if (!seenProviders.has(b.providerId)) {
        seenProviders.add(b.providerId);
        bookAgain.push({
          type: 'book_again',
          reason: `You booked ${b.provider.businessName} before`,
          provider: b.provider,
          lastService: b.service?.name,
          lastAmount: b.totalAmount,
          bookingCount: previousBookings.filter(pb => pb.providerId === b.providerId).length,
        });
      }
    }

    // 2. Similar providers based on categories used
    const bookedCategories = [...new Set(previousBookings.map(b => b.provider.category))];
    const similarProviders = await prisma.provider.findMany({
      where: {
        category: { in: bookedCategories.length > 0 ? bookedCategories : ['FUNDI'] },
        isVerified: true,
        id: { notIn: [...seenProviders] },
      },
      include: { user: { select: { location: true } } },
      orderBy: { rating: 'desc' },
      take: 6,
    });

    const similar = similarProviders.map(p => ({
      type: 'similar',
      reason: 'Similar to services you have used',
      provider: p,
    }));

    // 3. Top rated providers
    const topRated = await prisma.provider.findMany({
      where: { isVerified: true, rating: { gte: 4.0 } },
      include: { user: { select: { location: true } } },
      orderBy: [{ rating: 'desc' }, { totalReviews: 'desc' }],
      take: 6,
    });

    const top = topRated.map(p => ({
      type: 'top_rated',
      reason: 'Highly rated by customers',
      provider: p,
    }));

    // 4. Recently viewed providers
    const recentViews = await prisma.userInteraction.findMany({
      where: { userId, type: 'view' },
      include: { provider: { include: { user: { select: { location: true } } } } },
      orderBy: { lastAt: 'desc' },
      take: 4,
    });

    const recentlyViewed = recentViews.map(i => ({
      type: 'recently_viewed',
      reason: 'Recently viewed',
      provider: i.provider,
    }));

    // 5. New providers in user's area
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { location: true },
    });
    const locationKeyword = user?.location?.split(',')[0]?.trim() || 'Nairobi';

    const newProviders = await prisma.provider.findMany({
      where: {
        isVerified: true,
        user: { location: { contains: locationKeyword, mode: 'insensitive' } },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      include: { user: { select: { location: true } } },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });

    const newInArea = newProviders.map(p => ({
      type: 'new_in_area',
      reason: 'New provider near you',
      provider: p,
    }));

    res.json({
      success: true,
      data: {
        bookAgain: bookAgain.slice(0, 5),
        similar: similar.slice(0, 4),
        topRated: top.slice(0, 6),
        recentlyViewed: recentlyViewed.slice(0, 4),
        newInArea: newInArea.slice(0, 4),
      },
    });
  } catch (err) {
    console.error('❌ getRecommendations error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function recordInteraction(req, res) {
  try {
    const { providerId, type } = req.body;
    if (!providerId || !type) {
      return res.status(400).json({ success: false, message: 'providerId and type required' });
    }

    await prisma.userInteraction.upsert({
      where: { userId_providerId_type: { userId: req.user.id, providerId, type } },
      create: { userId: req.user.id, providerId, type, count: 1, lastAt: new Date() },
      update: { count: { increment: 1 }, lastAt: new Date() },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTrending(req, res) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trending = await prisma.booking.groupBy({
      by: ['providerId'],
      where: { createdAt: { gte: weekAgo }, status: { not: 'CANCELLED' } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    const providerIds = trending.map(t => t.providerId);
    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds }, isVerified: true },
      include: { user: { select: { location: true } } },
    });

    const result = trending
      .map(t => {
        const provider = providers.find(p => p.id === t.providerId);
        return provider ? { provider, bookingsThisWeek: t._count.id } : null;
      })
      .filter(Boolean);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getNearby(req, res) {
  try {
    const { lat, lng, radius = 10 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    const providers = await prisma.provider.findMany({
      where: { isVerified: true },
      include: { user: { select: { lat: true, lng: true, location: true } } },
    });

    const nearby = providers
      .map(p => {
        if (p.user.lat == null || p.user.lng == null) return null;
        const dist = haversineKm(parseFloat(lat), parseFloat(lng), p.user.lat, p.user.lng);
        if (dist > parseFloat(radius)) return null;
        return { ...p, distance: Math.round(dist * 10) / 10 };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);

    res.json({ success: true, data: nearby });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getRecommendations, recordInteraction, getTrending, getNearby };
