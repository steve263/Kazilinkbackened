const prisma = require('../config/db');
const notificationSvc = require('../services/notification.service');

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, location: true } },
  provider: {
    include: { user: { select: { id: true, name: true, phone: true, isOnline: true } } },
  },
  service: true,
  payment: true,
  review: true,
};

async function createBooking(req, res) {
  try {
    const { providerId, serviceId, scheduledDate, scheduledTime, address, lat, lng, notes } = req.body;

    if (!providerId || !scheduledDate || !scheduledTime || !address) {
      return res.status(400).json({
        success: false,
        message: 'providerId, scheduledDate, scheduledTime, and address are required',
      });
    }

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
    if (!provider.isVerified) {
      return res.status(400).json({ success: false, message: 'This provider is not yet verified' });
    }

    let totalAmount = provider.minJobValue;
    if (serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (service && service.priceType === 'FIXED') totalAmount = service.price;
    }

    const isFundi = provider.category === 'FUNDI';

    const booking = await prisma.$transaction(async (tx) => {
      return tx.booking.create({
        data: {
          customerId: req.user.id,
          providerId,
          serviceId: serviceId || null,
          scheduledDate: new Date(scheduledDate),
          scheduledTime,
          address,
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
          totalAmount,
          notes,
          status: 'PENDING',
        },
        include: BOOKING_INCLUDE,
      });
    });

    console.log(`📋 New booking created: ${booking.id} — ${req.user.name} → ${provider.businessName} [PENDING — awaiting provider]`);

    if (isFundi) {
      notificationSvc.notifyNewBooking({
        booking,
        providerUser: provider.user,
        customerUser: req.user,
      }).catch(console.error);
    } else {
      notificationSvc.notifyNewOrder({
        booking,
        providerUser: provider.user,
        customerUser: req.user,
      }).catch(console.error);
    }

    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    console.error('❌ createBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getBookings(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status.toUpperCase();

    if (req.user.role === 'CUSTOMER') {
      where.customerId = req.user.id;
    } else if (req.user.role === 'PROVIDER') {
      const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
      if (!provider) return res.status(404).json({ success: false, message: 'Provider profile not found' });
      where.providerId = provider.id;
    }
    // ADMIN sees all — no additional filter

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    console.error('❌ getBookings error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getBooking(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: BOOKING_INCLUDE,
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Customers can only see their own, providers their own
    if (req.user.role === 'CUSTOMER' && booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (req.user.role === 'PROVIDER') {
      const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
      if (!provider || booking.providerId !== provider.id) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('❌ getBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function acceptBooking(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { customer: true, provider: { include: { user: true } } },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (booking.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Cannot accept a booking with status ${booking.status}` });
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'ACCEPTED' },
      include: BOOKING_INCLUDE,
    });

    console.log(`✅ Booking accepted: ${booking.id} by ${booking.provider.businessName}`);

    notificationSvc.notifyBookingAccepted({
      booking: updated,
      customerUser: booking.customer,
      providerName: booking.provider.businessName,
    }).catch(console.error);

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ acceptBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function declineBooking(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { customer: true, provider: { include: { user: true } } },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (!['PENDING', 'ACCEPTED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot decline a booking with status ${booking.status}` });
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'DECLINED' },
      include: BOOKING_INCLUDE,
    });

    console.log(`❌ Booking declined: ${booking.id}`);

    notificationSvc.notifyBookingDeclined({
      booking: updated,
      customerUser: booking.customer,
      providerName: booking.provider.businessName,
    }).catch(console.error);

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ declineBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateStatus(req, res) {
  try {
    const { status } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { customer: true, provider: { include: { user: true } } },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const isFundi = booking.provider.category === 'FUNDI';
    const FUNDI_VALID = ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
    const BUSINESS_VALID = ['PREPARING', 'READY', 'COMPLETED'];
    const VALID = isFundi ? FUNDI_VALID : BUSINESS_VALID;

    if (!VALID.includes(status?.toUpperCase())) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID.join(', ')}` });
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: status.toUpperCase() },
      include: BOOKING_INCLUDE,
    });

    console.log(`🔄 Booking ${booking.id} → ${status.toUpperCase()} [${isFundi ? 'FUNDI' : 'BUSINESS'}]`);

    if (isFundi) {
      notificationSvc.notifyStatusUpdate({
        booking: updated,
        customerUser: booking.customer,
        status: status.toUpperCase(),
        providerName: booking.provider.businessName,
        providerUserId: booking.provider.user.id,
        totalAmount: booking.totalAmount,
      }).catch(console.error);
    } else {
      notificationSvc.notifyOrderStatusUpdate({
        booking: updated,
        customerUser: booking.customer,
        status: status.toUpperCase(),
        providerName: booking.provider.businessName,
      }).catch(console.error);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ updateStatus error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function cancelBooking(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'This booking cannot be cancelled' });
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
      include: BOOKING_INCLUDE,
    });

    console.log(`🚫 Booking cancelled: ${booking.id}`);

    // Cancel the auto-decline timer if still pending
    notificationSvc.cancelDeclineTimer(booking.id);

    const smsSvc = require('../services/sms.service');
    smsSvc
      .sendSMS(
        booking.provider.user.phone,
        smsSvc.tplBookingCancelledProvider(req.user.name)
      )
      .catch(console.error);

    const socketSvc = require('../services/socket.service');
    socketSvc.emitBookingCancelled(booking.provider.user.id, { bookingId: booking.id });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ cancelBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTracking(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        provider: {
          include: {
            user: { select: { id: true, name: true, phone: true, lat: true, lng: true, isOnline: true } },
          },
        },
        service: { select: { name: true } },
      },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id && booking.provider.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { locationCache } = require('../config/socket');
    const cached = locationCache.get(booking.id);

    res.json({
      success: true,
      data: {
        booking: {
          id: booking.id,
          status: booking.status,
          address: booking.address,
          lat: booking.lat,
          lng: booking.lng,
          scheduledDate: booking.scheduledDate,
          scheduledTime: booking.scheduledTime,
          totalAmount: booking.totalAmount,
          service: booking.service,
        },
        customer: booking.customer,
        provider: {
          id: booking.provider.id,
          businessName: booking.provider.businessName,
          category: booking.provider.category,
          profileImage: booking.provider.profileImage,
          userId: booking.provider.userId,
          user: booking.provider.user,
        },
        providerLocation: cached || { lat: booking.provider.user.lat, lng: booking.provider.user.lng, updatedAt: null },
      },
    });
  } catch (err) {
    console.error('❌ getTracking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  createBooking,
  getBookings,
  getBooking,
  acceptBooking,
  declineBooking,
  updateStatus,
  cancelBooking,
  getTracking,
};
