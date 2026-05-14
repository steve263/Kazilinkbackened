const prisma = require('../config/db');

// ─── Haversine distance (km) ───────────────────────────────────────────────────
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const activePromoWhere = { isActive: true, endDate: { gt: new Date() }, startDate: { lte: new Date() } };

const PROVIDER_SELECT = {
  user: {
    select: { id: true, name: true, phone: true, isOnline: true, lat: true, lng: true, location: true },
  },
  services: { where: { isActive: true }, take: 3 },
  promotions: { where: activePromoWhere, orderBy: { endDate: 'asc' }, take: 1 },
  _count: { select: { waitlist: { where: { notified: false } } } },
};

async function getProviders(req, res) {
  try {
    const { type, minRating, verified, lat, lng, radius } = req.query;

    const where = { isVerified: true };
    if (type) where.category = type.toUpperCase();
    if (verified === 'true') where.idVerified = true;
    if (minRating) where.rating = { gte: parseFloat(minRating) };

    let providers = await prisma.provider.findMany({
      where,
      include: PROVIDER_SELECT,
      orderBy: { rating: 'desc' },
    });

    if (lat && lng && radius) {
      const uLat = parseFloat(lat);
      const uLng = parseFloat(lng);
      const r = parseFloat(radius);
      providers = providers
        .filter((p) => !p.user.lat || distanceKm(uLat, uLng, p.user.lat, p.user.lng) <= r)
        .map((p) => ({
          ...p,
          distanceKm: p.user.lat ? distanceKm(uLat, uLng, p.user.lat, p.user.lng) : null,
        }))
        .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    }

    res.json({ success: true, data: providers });
  } catch (err) {
    console.error('❌ getProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getProvider(req, res) {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, phone: true, isOnline: true, lat: true, lng: true, location: true } },
        services: { where: { isActive: true } },
        promotions: { where: activePromoWhere, orderBy: { endDate: 'asc' } },
        reviews: {
          include: { customer: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    res.json({ success: true, data: provider });
  } catch (err) {
    console.error('❌ getProvider error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProvider(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    if (provider.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'You can only update your own profile' });
    }

    const {
      businessName, description, workingHoursStart, workingHoursEnd,
      radiusKm, minJobValue, profileImage, coverImage, portfolioPhotos,
      skills, yearsExperience, education, location,
    } = req.body;

    const [updated] = await prisma.$transaction([
      prisma.provider.update({
        where: { id: req.params.id },
        data: {
          ...(businessName && { businessName }),
          ...(description !== undefined && { description }),
          ...(workingHoursStart && { workingHoursStart }),
          ...(workingHoursEnd && { workingHoursEnd }),
          ...(radiusKm !== undefined && { radiusKm: parseInt(radiusKm) }),
          ...(minJobValue !== undefined && { minJobValue: parseInt(minJobValue) }),
          ...(profileImage && { profileImage }),
          ...(coverImage && { coverImage }),
          ...(Array.isArray(portfolioPhotos) && { portfolioPhotos }),
          ...(Array.isArray(skills) && { skills }),
          ...(yearsExperience !== undefined && { yearsExperience: yearsExperience || null }),
          ...(education !== undefined && { education: education || null }),
        },
      }),
      ...(location !== undefined ? [prisma.user.update({
        where: { id: provider.userId },
        data: { location: location || null },
      })] : []),
    ]);

    console.log(`✏️ Provider updated: ${updated.businessName}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ updateProvider error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleOnline(req, res) {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });

    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    if (provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const newState = req.body.isOnline !== undefined ? Boolean(req.body.isOnline) : !provider.user.isOnline;
    const updated = await prisma.user.update({
      where: { id: provider.userId },
      data: { isOnline: newState },
    });

    console.log(`📡 ${provider.businessName} is now ${updated.isOnline ? 'ONLINE' : 'OFFLINE'}`);
    res.json({ success: true, data: { isOnline: updated.isOnline } });
  } catch (err) {
    console.error('❌ toggleOnline error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateLocation(req, res) {
  try {
    const { lat, lng, location } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { lat: parseFloat(lat), lng: parseFloat(lng), ...(location && { location }) },
    });

    res.json({ success: true, data: { message: 'Location updated' } });
  } catch (err) {
    console.error('❌ updateLocation error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getEarnings(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    if (provider.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - dayOfWeek);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const base = { providerId: req.params.id, status: 'COMPLETED', paymentStatus: 'PAID' };

    const [today, week, month, allTime, recentBookings] = await Promise.all([
      prisma.booking.aggregate({ where: { ...base, updatedAt: { gte: startOfDay } }, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.aggregate({ where: { ...base, updatedAt: { gte: startOfWeek } }, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.aggregate({ where: { ...base, updatedAt: { gte: startOfMonth } }, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.aggregate({ where: base, _sum: { totalAmount: true }, _count: true }),
      prisma.booking.findMany({
        where: base,
        include: { customer: { select: { name: true } }, service: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    res.json({
      success: true,
      data: {
        walletBalance: provider.walletBalance,
        totalEarned:   provider.totalEarned,
        today:   { amount: today._sum.totalAmount   || 0, jobs: today._count },
        week:    { amount: week._sum.totalAmount    || 0, jobs: week._count },
        month:   { amount: month._sum.totalAmount   || 0, jobs: month._count },
        allTime: { amount: allTime._sum.totalAmount || 0, jobs: allTime._count },
        recentBookings,
      },
    });
  } catch (err) {
    console.error('❌ getEarnings error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getNearbyProviders(req, res) {
  try {
    const { lat, lng, radius = 10, category } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    const where = { isVerified: true };
    if (category) where.category = category.toUpperCase();

    const providers = await prisma.provider.findMany({
      where,
      include: {
        user: { select: { name: true, isOnline: true, lat: true, lng: true, location: true } },
        services: { where: { isActive: true }, take: 2 },
      },
    });

    const uLat = parseFloat(lat);
    const uLng = parseFloat(lng);
    const r = parseFloat(radius);

    const nearby = providers
      .filter((p) => p.user.lat && p.user.lng)
      .map((p) => ({ ...p, distanceKm: distanceKm(uLat, uLng, p.user.lat, p.user.lng) }))
      .filter((p) => p.distanceKm <= r)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    console.log(`📍 Found ${nearby.length} providers within ${r} km of (${uLat},${uLng})`);
    res.json({ success: true, data: nearby });
  } catch (err) {
    console.error('❌ getNearbyProviders error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllServices(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const isOwner = provider.userId === req.user?.id;
    const services = await prisma.service.findMany({
      where: { providerId: req.params.id, ...(!isOwner && { isActive: true }) },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: services });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addService(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    if (provider.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    const { name, description, price, priceType = 'FIXED', duration } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'name and price are required' });
    }

    const service = await prisma.service.create({
      data: {
        providerId: req.params.id,
        name: name.trim(),
        description: description?.trim() || null,
        price: parseFloat(price),
        priceType: priceType.toUpperCase(),
        duration: duration ? parseInt(duration) : null,
        isActive: true,
      },
    });
    console.log(`➕ Service added: ${service.name} for provider ${req.params.id}`);
    res.status(201).json({ success: true, data: service });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateService(req, res) {
  try {
    const service = await prisma.service.findUnique({
      where: { id: req.params.serviceId },
      include: { provider: true },
    });
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    if (service.provider.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    const { name, description, price, priceType, duration, isActive } = req.body;
    const updated = await prisma.service.update({
      where: { id: req.params.serviceId },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(priceType && { priceType: priceType.toUpperCase() }),
        ...(duration !== undefined && { duration: duration ? parseInt(duration) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteService(req, res) {
  try {
    const service = await prisma.service.findUnique({
      where: { id: req.params.serviceId },
      include: { provider: true },
    });
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    if (service.provider.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    await prisma.service.delete({ where: { id: req.params.serviceId } });
    console.log(`🗑️ Service deleted: ${service.name}`);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyProvider(req, res) {
  try {
    const provider = await prisma.provider.findUnique({
      where: { userId: req.user.id },
      include: {
        services: { where: { isActive: true } },
        user: { select: { id: true, name: true, phone: true, email: true, profilePhoto: true } },
      },
    });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider profile not found' });
    res.json({ success: true, data: provider });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── Availability Schedule ──────────────────────────────────────────────────────

async function getSchedule(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    let schedule = await prisma.providerAvailability.findUnique({
      where: { providerId: provider.id },
      include: { exceptions: { orderBy: { date: 'asc' } } },
    });

    if (!schedule) {
      schedule = await prisma.providerAvailability.create({
        data: { providerId: provider.id },
        include: { exceptions: true },
      });
    }

    res.json({ success: true, data: schedule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateSchedule(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const { monday, tuesday, wednesday, thursday, friday, saturday, sunday, startTime, endTime, slotDuration, breakStart, breakEnd } = req.body;

    const schedule = await prisma.providerAvailability.upsert({
      where: { providerId: provider.id },
      create: { providerId: provider.id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, startTime, endTime, slotDuration: slotDuration || 60, breakStart, breakEnd },
      update: { monday, tuesday, wednesday, thursday, friday, saturday, sunday, startTime, endTime, slotDuration: slotDuration || 60, breakStart, breakEnd },
      include: { exceptions: true },
    });

    res.json({ success: true, data: schedule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addException(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    let schedule = await prisma.providerAvailability.findUnique({ where: { providerId: provider.id } });
    if (!schedule) schedule = await prisma.providerAvailability.create({ data: { providerId: provider.id } });

    const exception = await prisma.availabilityException.create({
      data: { availabilityId: schedule.id, date: new Date(req.body.date), isAvailable: req.body.isAvailable ?? false, reason: req.body.reason || null },
    });

    res.json({ success: true, data: exception });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function removeException(req, res) {
  try {
    await prisma.availabilityException.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAvailableSlots(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date query param is required' });

    const provider = await prisma.provider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    let schedule = await prisma.providerAvailability.findUnique({
      where: { providerId: provider.id },
      include: { exceptions: true },
    });

    if (!schedule) {
      schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, startTime: '08:00', endTime: '18:00', slotDuration: 60, exceptions: [] };
    }

    const selectedDate = new Date(date);
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[selectedDate.getDay()];

    const exception = schedule.exceptions?.find(e => new Date(e.date).toDateString() === selectedDate.toDateString());
    if (exception && !exception.isAvailable) return res.json({ success: true, data: { available: false, slots: [], reason: exception.reason || 'Not available on this date' } });
    if (!exception && !schedule[dayName]) return res.json({ success: true, data: { available: false, slots: [], reason: 'Provider does not work on this day' } });

    const slots = [];
    const [sh, sm] = schedule.startTime.split(':').map(Number);
    const [eh, em] = schedule.endTime.split(':').map(Number);
    const duration = schedule.slotDuration || 60;
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;

    while (cur + duration <= end) {
      const h = Math.floor(cur / 60), m = cur % 60;
      const timeStr = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 || 12;
      const displayTime = `${displayH}:${m.toString().padStart(2,'0')} ${ampm}`;

      const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
      const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999);

      const existing = await prisma.booking.findFirst({
        where: { providerId: provider.id, scheduledDate: { gte: dayStart, lte: dayEnd }, scheduledTime: displayTime, status: { in: ['PENDING','ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS'] } },
      });

      slots.push({ time: displayTime, timeStr, available: !existing });
      cur += duration;
    }

    res.json({ success: true, data: { available: true, slots } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getProviders,
  getProvider,
  getMyProvider,
  updateProvider,
  toggleOnline,
  updateLocation,
  getEarnings,
  getNearbyProviders,
  getAllServices,
  addService,
  updateService,
  deleteService,
  getSchedule,
  updateSchedule,
  addException,
  removeException,
  getAvailableSlots,
};
