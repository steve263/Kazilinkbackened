const prisma = require('../config/db');
const notificationSvc = require('../services/notification.service');
const trustSvc = require('../services/trust.service');
const socketSvc = require('../services/socket.service');
const mpesaSvc = require('../services/mpesa.service');
const smsSvc = require('../services/sms.service');

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, location: true, deviceToken: true } },
  provider: {
    include: { user: { select: { id: true, name: true, phone: true, isOnline: true, deviceToken: true } } },
  },
  service: true,
  payment: true,
  review: true,
  cancellation: true,
};

async function createBooking(req, res) {
  try {
    const { providerId, serviceId, serviceIds, serviceNames, scheduledDate, scheduledTime, address, lat, lng, notes, totalAmount: bodyAmount } = req.body;

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

    // Block bookings for business providers with expired subscriptions
    if (provider.category !== 'FUNDI') {
      const subSvc = require('../services/subscription.service');
      const isActive = await subSvc.isSubscriptionActive(provider.id);
      if (!isActive) {
        return res.status(403).json({
          success: false,
          message: 'This business is not currently accepting bookings. Please try another provider.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    }

    let totalAmount = bodyAmount ? parseFloat(bodyAmount) : (provider.minJobValue || 0);

    // Multi-service: verify total by fetching actual DB prices
    if (Array.isArray(serviceIds) && serviceIds.length > 0) {
      const dbServices = await prisma.service.findMany({ where: { id: { in: serviceIds } } });
      const correctTotal = dbServices.reduce((sum, s) => sum + (s.price || 0), 0);
      if (correctTotal > 0) totalAmount = correctTotal;
    } else if (!bodyAmount && serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (service && service.priceType === 'FIXED') totalAmount = service.price;
    }

    // Prepend selected service names to notes so provider sees them
    const finalNotes = serviceNames
      ? `Services: ${serviceNames}\n${notes || ''}`.trim()
      : notes;

    const isFundi = provider.category === 'FUNDI';

    // Busy check only applies to Fundi (mobile provider currently on a job)
    if (isFundi && provider.isBusy) {
      return res.status(400).json({
        success: false,
        message: 'PROVIDER_BUSY',
        data: {
          id: provider.id,
          businessName: provider.businessName,
          category: provider.category,
          profileImage: provider.profileImage,
        },
      });
    }

    // Block Fundi with a commission payment awaiting admin verification
    if (isFundi) {
      const pendingVerification = await prisma.outstandingCommission.findFirst({
        where: { providerId: provider.id, status: 'PENDING_VERIFICATION' },
      });
      if (pendingVerification) {
        return res.status(403).json({
          success: false,
          message: 'This Fundi has a pending commission payment being verified. Please try again later.',
          code: 'COMMISSION_PENDING',
        });
      }
    }
    const finalPaymentMethod = isFundi ? 'CASH_OR_MPESA' : 'PAY_AT_VENUE';

    // Use first serviceId for the FK, multi-service names stored in notes
    const primaryServiceId = serviceId || (Array.isArray(serviceIds) && serviceIds[0]) || null;

    const booking = await prisma.$transaction(async (tx) => {
      return tx.booking.create({
        data: {
          customerId: req.user.id,
          providerId,
          serviceId: primaryServiceId,
          scheduledDate: new Date(scheduledDate),
          scheduledTime,
          address,
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
          totalAmount,
          notes: finalNotes,
          paymentMethod: finalPaymentMethod,
          status: 'PENDING',
        },
        include: BOOKING_INCLUDE,
      });
    });

    console.log(`📋 New booking created: ${booking.id} — ${req.user.name} → ${provider.businessName} [PENDING — awaiting provider]`);

    // Emit real-time popup to the provider (include all service names if multi-select)
    socketSvc.emitNewBookingRequest(provider.user.id, {
      bookingId: booking.id,
      customerName: req.user.name,
      customerPhone: req.user.phone || '',
      customerPhoto: req.user.profilePhoto || null,
      service: serviceNames || booking.service?.name || null,
      address: booking.address,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      totalAmount: booking.totalAmount,
      notes: booking.notes || null,
    });

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

    // SMS to customer confirming booking submitted
    if (req.user.phone) {
      smsSvc.sendSMS(
        req.user.phone,
        `Your KaziShow booking has been submitted! We will notify you once ${provider.businessName} confirms. Track your booking at kazishow.co.ke`
      ).catch(console.error);
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
    // Idempotent: already accepted by this provider — just return success
    if (booking.status === 'ACCEPTED') {
      return res.json({ success: true, data: booking });
    }

    if (booking.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Cannot accept a booking with status ${booking.status}` });
    }

    const acceptedAt = new Date();
    const responseMinutes = Math.round((acceptedAt.getTime() - new Date(booking.createdAt).getTime()) / 60000);

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'ACCEPTED', acceptedAt },
      include: BOOKING_INCLUDE,
    });

    // Update rolling average response time (70/30 weighted toward history)
    const currentAvg = booking.provider.avgResponseMinutes;
    const newAvg = currentAvg
      ? Math.round(currentAvg * 0.7 + responseMinutes * 0.3)
      : responseMinutes;

    // Mark provider as BUSY and record response time
    await prisma.provider.update({
      where: { id: booking.providerId },
      data: { isBusy: true, busySince: new Date(), avgResponseMinutes: newAvg },
    });
    console.log(`🔴 Provider ${booking.provider.businessName} is now BUSY · avg response: ${newAvg}min`);

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

    const updateData = { status: status.toUpperCase() };
    if (status.toUpperCase() === 'COMPLETED') {
      updateData.completedByProvider = new Date();
      const photos = req.body.photos;
      if (Array.isArray(photos) && photos.length > 0) {
        updateData.jobPhotos = JSON.stringify(photos);
      }
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: updateData,
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

    // ── On COMPLETED: notify based on payment method ───────────────────────────
    if (status.toUpperCase() === 'COMPLETED') {
      const smsSvc = require('../services/sms.service');
      const paymentMethod = booking.paymentMethod || 'MPESA';
      const isEscrow = paymentMethod === 'MPESA' && booking.paymentStatus === 'PAID';
      const isCash = paymentMethod === 'CASH';
      const isPayAfter = paymentMethod === 'PAY_AFTER';

      if (isEscrow) {
        // Emit real-time popup to customer instantly
        const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
        let parsedPhotos = [];
        try { parsedPhotos = JSON.parse(updateData.jobPhotos || booking.jobPhotos || '[]'); } catch {}
        socketSvc.emitJobCompletionRequest(booking.customerId, {
          bookingId: booking.id,
          providerName: booking.provider.businessName,
          providerPhoto: booking.provider.profileImage || null,
          serviceName: booking.service?.name || 'Service',
          amount: booking.totalAmount,
          providerAmount: Math.round(booking.totalAmount * (1 - commissionRate)),
          message: `${booking.provider.businessName} says the job is complete!`,
          photos: parsedPhotos,
        });
        console.log(`📨 Job completion popup sent to customer ${booking.customerId}`);

        // Money in escrow — ask customer to confirm release
        notificationSvc.createNotification({
          userId: booking.customerId,
          type: 'BOOKING_COMPLETED',
          title: '✅ Job Complete — Please Confirm!',
          body: `${booking.provider.businessName} says the job is done! Confirm to release KSh ${booking.totalAmount} payment. Auto-releases in 24 hours.`,
          bookingId: booking.id,
        }).catch(console.error);

        if (booking.customer.deviceToken) {
          const firebaseSvc = require('../services/firebase.service');
          firebaseSvc.sendPushNotification({
            deviceToken: booking.customer.deviceToken,
            title: '✅ Job Done — Confirm Payment!',
            body: `${booking.provider.businessName} completed the job. Tap to confirm and release payment.`,
            data: { url: '/profile', bookingId: booking.id, type: 'CONFIRM_COMPLETE' },
          }).catch(console.error);
        }

        smsSvc.sendSMS(
          booking.customer.phone,
          `KaziShow: ${booking.provider.businessName} completed the job! Open the app to confirm and release KSh ${booking.totalAmount}. Auto-releases in 24 hours.`
        ).catch(console.error);

      } else if (isCash) {
        // Cash payment — remind provider to collect, remind customer to pay
        notificationSvc.createNotification({
          userId: booking.provider.userId,
          type: 'SYSTEM',
          title: '💵 Collect Cash from Customer',
          body: `Job complete! Collect KSh ${booking.totalAmount} cash from ${booking.customer.name}. Then tap "Cash Received" to record it.`,
          bookingId: booking.id,
        }).catch(console.error);

        smsSvc.sendSMS(
          booking.provider.user.phone,
          `KaziShow: Job done! Collect KSh ${booking.totalAmount} cash from ${booking.customer.name} (${booking.customer.phone}).`
        ).catch(console.error);

        notificationSvc.createNotification({
          userId: booking.customerId,
          type: 'SYSTEM',
          title: '💵 Please Pay the Provider',
          body: `${booking.provider.businessName} completed your job. Pay KSh ${booking.totalAmount} cash directly to the provider.`,
          bookingId: booking.id,
        }).catch(console.error);

        smsSvc.sendSMS(
          booking.customer.phone,
          `KaziShow: ${booking.provider.businessName} completed the job. Please pay KSh ${booking.totalAmount} cash to the provider.`
        ).catch(console.error);

      } else if (isPayAfter) {
        // Pay after — remind provider to collect, remind customer payment is due
        notificationSvc.createNotification({
          userId: booking.provider.userId,
          type: 'SYSTEM',
          title: '⏰ Collect Payment from Customer',
          body: `Job complete! Remind ${booking.customer.name} to pay KSh ${booking.totalAmount}. Payment is due now. Their number: ${booking.customer.phone}`,
          bookingId: booking.id,
        }).catch(console.error);

        smsSvc.sendSMS(
          booking.provider.user.phone,
          `KaziShow: Job done! Remind ${booking.customer.name} to pay KSh ${booking.totalAmount}. Contact: ${booking.customer.phone}`
        ).catch(console.error);

        notificationSvc.createNotification({
          userId: booking.customerId,
          type: 'SYSTEM',
          title: '💳 Payment Due Now!',
          body: `${booking.provider.businessName} completed your job. Please pay KSh ${booking.totalAmount} as agreed. M-Pesa: ${booking.provider.user.phone}`,
          bookingId: booking.id,
        }).catch(console.error);

        smsSvc.sendSMS(
          booking.customer.phone,
          `KaziShow: ${booking.provider.businessName} completed your job. Please pay KSh ${booking.totalAmount} as agreed. M-Pesa: ${booking.provider.user.phone}`
        ).catch(console.error);
      }

      // Auto-create commission for FUNDI non-escrow bookings
      if (isFundi && !isEscrow) {
        const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
        const commissionAmount = Math.round(booking.totalAmount * commissionRate);
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 24);
        await prisma.outstandingCommission.upsert({
          where: { bookingId: booking.id },
          create: {
            providerId: booking.providerId,
            bookingId: booking.id,
            cashAmount: booking.totalAmount || 0,
            commissionAmount,
            amount: commissionAmount,
            status: 'PENDING',
            dueDate,
            dueAt: dueDate,
            reminderCount: 0,
          },
          update: {},
        }).catch((e) => console.error('Commission upsert error:', e.message));
        console.log(`💰 Commission created: KSh ${commissionAmount} for booking ${booking.id}`);
      }

      await prisma.provider.update({
        where: { id: booking.providerId },
        data: { isBusy: false, busySince: null },
      });
      console.log(`🟢 Provider ${booking.provider.businessName} is now FREE`);
      notifyWaitlist(booking.providerId, booking.provider.businessName).catch(console.error);
      completeReferralIfFirst(booking.customerId, booking.customer).catch(console.error);
      trustSvc.updateTrustScore(booking.customerId, 'completedJob').catch(console.error);
      trustSvc.updateTrustScore(booking.provider.user.id, 'completedJob').catch(console.error);
      trustSvc.detectFraud(booking.customerId).catch(console.error);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('❌ updateStatus error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function cancelBooking(req, res) {
  try {
    const { reason } = req.body;
    const bookingId = req.params.id;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Please provide a reason for cancellation' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: { include: { user: true } },
        service: true,
        payment: true,
      },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const isCustomer = booking.customerId === req.user.id;
    const isProvider = booking.provider.userId === req.user.id;

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this booking' });
    }
    if (['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a booking that is already ${booking.status.toLowerCase()}`,
      });
    }

    // Calculate refund amount
    const now = new Date();
    const scheduledTime = new Date(booking.scheduledDate);
    const hoursUntilBooking = (scheduledTime - now) / (1000 * 60 * 60);
    const isPaid = booking.paymentStatus === 'PAID' || booking.payment?.status === 'SUCCESS';

    let refundAmount = 0;
    let refundMessage = '';

    if (isPaid) {
      if (isCustomer) {
        if (hoursUntilBooking >= 2) {
          refundAmount = booking.totalAmount;
          refundMessage = `Full refund of KSh ${refundAmount} will be sent to your M-Pesa within 24 hours`;
        } else if (hoursUntilBooking > 0) {
          refundAmount = Math.round(booking.totalAmount * 0.5);
          refundMessage = `50% refund of KSh ${refundAmount} will be sent to your M-Pesa (cancelled less than 2 hours before booking)`;
        } else {
          refundMessage = 'No refund — booking time has already passed';
        }
      } else {
        // Provider cancels — full refund always
        refundAmount = booking.totalAmount;
        refundMessage = `Full refund of KSh ${refundAmount} will be sent to customer M-Pesa within 24 hours`;
      }
    } else {
      refundMessage = 'No payment was made for this booking';
    }

    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });

    await prisma.bookingCancellation.create({
      data: {
        bookingId,
        cancelledBy: req.user.id,
        reason,
        refundAmount,
        refundStatus: refundAmount > 0 ? 'PENDING' : 'NOT_APPLICABLE',
      },
    });

    // Free provider if was active
    if (['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'PREPARING', 'READY'].includes(booking.status)) {
      await prisma.provider.update({
        where: { id: booking.providerId },
        data: { isBusy: false, busySince: null },
      });
      notifyWaitlist(booking.providerId, booking.provider.businessName).catch(console.error);
    }

    notificationSvc.cancelDeclineTimer(booking.id);
    socketSvc.emitBookingCancelled(booking.provider.user.id, { bookingId: booking.id });
    trustSvc.updateTrustScore(req.user.id, 'cancelledJob').catch(console.error);
    trustSvc.detectFraud(req.user.id).catch(console.error);

    const smsSvc = require('../services/sms.service');

    if (isCustomer) {
      // Notify provider
      notificationSvc.createNotification({
        userId: booking.provider.userId,
        type: 'SYSTEM',
        title: '❌ Booking Cancelled',
        body: `${booking.customer.name} cancelled the booking for ${booking.service?.name || 'Service'}. Reason: ${reason}`,
        bookingId,
      }).catch(console.error);
      smsSvc.sendSMS(
        booking.provider.user.phone,
        `KaziShow: ${booking.customer.name} cancelled the booking for ${booking.service?.name || 'Service'} on ${new Date(booking.scheduledDate).toLocaleDateString('en-KE')}. Reason: ${reason}`
      ).catch(console.error);
      // Notify customer of refund status
      notificationSvc.createNotification({
        userId: booking.customerId,
        type: 'SYSTEM',
        title: '✅ Booking Cancelled',
        body: `Your booking has been cancelled. ${refundMessage}`,
        bookingId,
      }).catch(console.error);
    } else {
      // Provider cancelled — notify customer with full refund
      notificationSvc.createNotification({
        userId: booking.customerId,
        type: 'SYSTEM',
        title: '❌ Provider Cancelled Your Booking',
        body: `${booking.provider.businessName} cancelled your booking. ${refundMessage}. We apologise for the inconvenience.`,
        bookingId,
      }).catch(console.error);
      smsSvc.sendSMS(
        booking.customer.phone,
        `KaziShow: ${booking.provider.businessName} cancelled your booking for ${booking.service?.name || 'Service'}. ${refundMessage}. Please book another provider.`
      ).catch(console.error);
    }

    // Notify admins
    prisma.user.findMany({ where: { role: 'ADMIN' } }).then((admins) => {
      for (const admin of admins) {
        notificationSvc.createNotification({
          userId: admin.id,
          type: 'SYSTEM',
          title: '❌ Booking Cancelled',
          body: `Cancelled by ${isCustomer ? booking.customer.name : booking.provider.businessName}. Refund: KSh ${refundAmount}. Reason: ${reason}`,
          bookingId,
        }).catch(console.error);
      }
    }).catch(console.error);

    console.log(`❌ Booking ${bookingId} cancelled — Refund: KSh ${refundAmount}`);

    res.json({
      success: true,
      data: { message: 'Booking cancelled successfully', refundAmount, refundMessage },
    });
  } catch (err) {
    console.error('❌ cancelBooking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── RELEASE PAYMENT TO PROVIDER ────────────────────────────────────────────────
async function releasePaymentToProvider(booking) {
  try {
    const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
    const commission = Math.round(booking.totalAmount * commissionRate);
    const providerAmount = booking.totalAmount - commission;

    // Update payment record with split amounts
    if (booking.payment) {
      await prisma.payment.update({
        where: { bookingId: booking.id },
        data: { providerAmount, commission },
      });
    }

    // Credit provider wallet
    await prisma.provider.update({
      where: { id: booking.providerId },
      data: {
        walletBalance: { increment: providerAmount },
        totalEarned: { increment: providerAmount },
      },
    });

    // Mark payment as released on booking
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentReleasedAt: new Date() },
    });

    // Notify provider
    const notifSvc = require('../services/notification.service');
    notifSvc.createNotification({
      userId: booking.provider.userId,
      type: 'PAYMENT_RECEIVED',
      title: '💰 Payment Released!',
      body: `KSh ${providerAmount} has been added to your earnings for ${booking.service?.name || 'Service'}. Well done!`,
      bookingId: booking.id,
    }).catch(console.error);

    if (booking.provider.user?.deviceToken) {
      const firebaseSvc = require('../services/firebase.service');
      firebaseSvc.sendPushNotification({
        deviceToken: booking.provider.user.deviceToken,
        title: '💰 Payment Released!',
        body: `KSh ${providerAmount} earned from ${booking.customer.name}. Check your earnings.`,
        data: { url: '/provider/earnings' },
      }).catch(console.error);
    }

    const smsSvc = require('../services/sms.service');
    smsSvc.sendSMS(
      booking.provider.user.phone,
      `KaziShow: KSh ${providerAmount} has been released to your earnings for completing ${booking.service?.name || 'Service'} for ${booking.customer.name}. Check your earnings dashboard.`
    ).catch(console.error);

    console.log(`💰 Payment released: KSh ${providerAmount} to ${booking.provider.businessName}`);
  } catch (err) {
    console.error('❌ releasePaymentToProvider error:', err.message);
    throw err;
  }
}

// ── CUSTOMER CONFIRMS JOB COMPLETE ─────────────────────────────────────────────
async function confirmJobComplete(req, res) {
  try {
    const bookingId = req.params.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only the customer can confirm job completion' });
    }
    if (booking.status !== 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'This booking has not been marked as completed yet' });
    }
    if (booking.customerConfirmed) {
      return res.status(400).json({ success: false, message: 'You have already confirmed this job' });
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { customerConfirmed: true, customerConfirmedAt: new Date() },
    });

    await releasePaymentToProvider(booking);

    console.log(`✅ Customer confirmed job complete: ${bookingId}`);

    res.json({
      success: true,
      data: { message: 'Thank you for confirming! Payment has been released to the provider.' },
    });
  } catch (err) {
    console.error('❌ confirmJobComplete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN CANCELLATION STATS ───────────────────────────────────────────────────
async function getCancellationStats(req, res) {
  try {
    const { filter = 'ALL', page = '1', limit = '20', search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (filter === 'PENDING_REFUND')    where.refundStatus = 'PENDING';
    if (filter === 'REFUNDED')          where.refundStatus = 'REFUNDED';
    if (filter === 'NOT_APPLICABLE')    where.refundStatus = 'NOT_APPLICABLE';
    if (search.trim()) {
      where.OR = [
        { booking: { customer: { name: { contains: search, mode: 'insensitive' } } } },
        { booking: { provider: { businessName: { contains: search, mode: 'insensitive' } } } },
        { reason: { contains: search, mode: 'insensitive' } },
      ];
    }

    const bookingInclude = {
      customer: { select: { name: true, phone: true } },
      provider: { select: { businessName: true } },
      service:  { select: { name: true } },
    };

    const [cancellations, total, aggregate, refundRequests, stats] = await Promise.all([
      prisma.bookingCancellation.findMany({
        where,
        include: {
          booking: { include: bookingInclude },
          user: { select: { name: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.bookingCancellation.count({ where }),
      prisma.bookingCancellation.aggregate({
        where: { refundStatus: 'PENDING' },
        _sum: { refundAmount: true },
        _count: true,
      }),
      // Refund requests: bookings where customer has requested a refund
      // REFUND_REQUESTED = pending admin action, REFUNDED = already processed (history)
      prisma.booking.findMany({
        where: {
          status: { in: ['CANCELLED', 'DECLINED'] },
          paymentStatus: { in: ['REFUND_REQUESTED', 'REFUNDED'] },
          totalAmount: { gt: 0 },
        },
        include: {
          customer: { select: { name: true, phone: true } },
          provider: { select: { businessName: true } },
          service:  { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      // Summary stats
      Promise.all([
        prisma.bookingCancellation.count(),
        prisma.bookingCancellation.aggregate({ _sum: { refundAmount: true } }),
        prisma.bookingCancellation.count({ where: { refundStatus: 'REFUNDED' } }),
        prisma.bookingCancellation.count({ where: { refundStatus: 'PENDING' } }),
      ]),
    ]);

    const [totalCancellations, totalRefundAgg, totalRefunded, totalPending] = stats;

    res.json({
      success: true,
      data: {
        cancellations,
        refundRequests,
        pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
        pendingRefunds: aggregate._count,
        pendingRefundAmount: aggregate._sum.refundAmount || 0,
        summary: {
          totalCancellations,
          totalRefundAmount: totalRefundAgg._sum.refundAmount || 0,
          totalRefunded,
          totalPending,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN: MARK REFUND AS PROCESSED ──────────────────────────────────────────
// id can be a BookingCancellation id OR a Booking id — we try both
async function markRefundProcessed(req, res) {
  try {
    const { id } = req.params;

    // Try as cancellation record first
    let cancellation = await prisma.bookingCancellation.findUnique({ where: { id } });

    // If not found, treat id as booking id and look up via bookingId
    if (!cancellation) {
      cancellation = await prisma.bookingCancellation.findFirst({ where: { bookingId: id } });
    }

    if (cancellation) {
      await prisma.bookingCancellation.update({
        where: { id: cancellation.id },
        data: { refundStatus: 'REFUNDED', refundedAt: new Date() },
      });
      await prisma.booking.update({
        where: { id: cancellation.bookingId },
        data: { paymentStatus: 'REFUNDED' },
      }).catch(() => {});
    } else {
      // No cancellation record — just update the booking's paymentStatus
      const booking = await prisma.booking.findUnique({ where: { id } });
      if (!booking) return res.status(404).json({ success: false, message: 'Not found' });
      await prisma.booking.update({
        where: { id },
        data: { paymentStatus: 'REFUNDED' },
      });
    }

    res.json({ success: true, data: { message: 'Refund marked as processed' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN: SEND B2C REFUND VIA M-PESA ────────────────────────────────────────
async function sendB2CRefund(req, res) {
  try {
    const { id } = req.params; // booking id
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!booking.customer?.phone) return res.status(400).json({ success: false, message: 'Customer has no phone number' });
    if (!booking.totalAmount || booking.totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid refund amount' });
    }

    const b2cResult = await mpesaSvc.b2c({
      phone: booking.customer.phone,
      amount: booking.totalAmount,
      withdrawalId: `REFUND-${booking.id}`,
      remarks: `KaziShow refund for cancelled booking`,
    });

    // Mark booking as refunded
    await prisma.booking.update({
      where: { id },
      data: { paymentStatus: 'REFUNDED' },
    });

    // Update cancellation record if it exists
    await prisma.bookingCancellation.updateMany({
      where: { bookingId: id },
      data: { refundStatus: 'REFUNDED', refundedAt: new Date() },
    }).catch(() => {});

    // Notify customer
    if (booking.customer.id) {
      await notificationSvc.createNotification({
        userId: booking.customer.id,
        type: 'BOOKING_UPDATE',
        title: 'Refund Sent',
        message: `Your refund of KSh ${booking.totalAmount.toLocaleString()} has been sent to ${booking.customer.phone} via M-Pesa.`,
      });
    }

    res.json({ success: true, data: { message: 'B2C refund initiated', mpesa: b2cResult } });
  } catch (err) {
    console.error('❌ sendB2CRefund error:', err.message);
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

    // Fall back to DB if not in memory cache
    let providerLocation = cached
      ? { lat: cached.lat, lng: cached.lng, heading: cached.heading, updatedAt: new Date(cached.updatedAt) }
      : null;

    if (!providerLocation) {
      const dbLoc = await prisma.providerLocation.findUnique({ where: { providerId: booking.providerId } });
      if (dbLoc) {
        providerLocation = { lat: dbLoc.lat, lng: dbLoc.lng, heading: dbLoc.heading, updatedAt: dbLoc.updatedAt };
      } else {
        providerLocation = { lat: booking.provider.user.lat, lng: booking.provider.user.lng, heading: null, updatedAt: null };
      }
    }

    // Calculate distance + ETA
    let distance = null;
    let etaMinutes = null;
    if (providerLocation?.lat && providerLocation?.lng && booking.lat && booking.lng) {
      const R = 6371;
      const dLat = (booking.lat - providerLocation.lat) * Math.PI / 180;
      const dLng = (booking.lng - providerLocation.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(providerLocation.lat * Math.PI / 180) * Math.cos(booking.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
      etaMinutes = Math.round((distance / 30) * 60);
    }

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
          phone: booking.provider.user.phone,
        },
        providerLocation,
        distance,
        etaMinutes,
      },
    });
  } catch (err) {
    console.error('❌ getTracking error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProviderLocation(req, res) {
  try {
    const { lat, lng, heading, speed } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ success: false, message: 'lat and lng required' });

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { provider: { select: { id: true, userId: true } } },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.provider.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    await prisma.providerLocation.upsert({
      where: { providerId: booking.providerId },
      create: { providerId: booking.providerId, lat, lng, heading, speed },
      update: { lat, lng, heading, speed },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function notifyWaitlist(providerId, providerName) {
  const waitlist = await prisma.providerWaitlist.findMany({
    where: { providerId, notified: false },
    include: { customer: true },
  });

  console.log(`📋 Notifying ${waitlist.length} waitlist customers for ${providerName}`);

  for (const entry of waitlist) {
    notificationSvc.createNotification({
      userId: entry.customerId,
      type: 'SYSTEM',
      title: '🟢 Provider Now Available!',
      body: `${providerName} is now free! Book them before someone else does.`,
    }).catch(console.error);

    if (entry.customer.deviceToken) {
      const firebaseSvc = require('../services/firebase.service');
      firebaseSvc.sendPushNotification({
        deviceToken: entry.customer.deviceToken,
        title: '🟢 Provider Now Available!',
        body: `${providerName} is now free! Book them before someone else does.`,
        emoji: '🟢',
        data: { url: `/business/${providerId}`, type: 'PROVIDER_AVAILABLE' },
      }).catch(console.error);
    }

    const smsSvc = require('../services/sms.service');
    smsSvc.sendSMS(
      entry.customer.phone,
      `KaziShow: Great news! ${providerName} is now available. Book them now at kazishow.vercel.app before someone else does!`
    ).catch(console.error);

    await prisma.providerWaitlist.update({
      where: { id: entry.id },
      data: { notified: true, notifiedAt: new Date() },
    });
  }
}

async function completeReferralIfFirst(customerId, customerUser) {
  const completedCount = await prisma.booking.count({
    where: { customerId, status: 'COMPLETED' },
  });

  if (completedCount !== 1) return;

  const referral = await prisma.referral.findFirst({
    where: { referredId: customerId, status: 'REGISTERED' },
    include: {
      referrer: { select: { id: true, name: true, phone: true, deviceToken: true } },
      referred:  { select: { id: true, name: true } },
    },
  });

  if (!referral) return;

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: 'REWARDED', completedAt: new Date(), rewardPaid: true },
  });

  await prisma.reward.create({
    data: {
      userId: referral.referrerId,
      type: 'REFERRAL_BONUS',
      amount: 200,
      description: `KSh 200 reward for referring ${referral.referred.name}!`,
      status: 'ACTIVE',
      referralId: referral.id,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.update({
    where: { id: referral.referrerId },
    data: { totalRewards: { increment: 200 } },
  });

  // Mark new user's discount as used
  await prisma.reward.updateMany({
    where: { userId: customerId, type: 'FIRST_BOOKING_DISCOUNT', status: 'ACTIVE' },
    data: { status: 'USED', usedAt: new Date() },
  });

  notificationSvc.createNotification({
    userId: referral.referrerId,
    type: 'SYSTEM',
    title: '💰 Referral Reward Earned!',
    body: `${referral.referred.name} completed their first booking! You earned KSh 200 reward.`,
  }).catch(console.error);

  if (referral.referrer.deviceToken) {
    const firebaseSvc = require('../services/firebase.service');
    firebaseSvc.sendPushNotification({
      deviceToken: referral.referrer.deviceToken,
      title: '💰 You earned KSh 200!',
      body: `${referral.referred.name} completed their first booking. Your reward is ready!`,
      emoji: '💰',
      data: { url: '/profile/referrals' },
    }).catch(console.error);
  }

  const smsSvc = require('../services/sms.service');
  smsSvc.sendSMS(
    referral.referrer.phone,
    `KaziShow: Congratulations! ${referral.referred.name} completed their first booking. You earned KSh 200 referral reward! Check your rewards in the app.`
  ).catch(console.error);

  console.log(`💰 Referral reward paid: KSh 200 to ${referral.referrer.name}`);
}

// ── MARK CASH PAID (provider submits Equity Bank message after paying commission)
async function markCashPaid(req, res) {
  try {
    const bookingId = req.params.id;
    const { mpesaCode, commissionAmount: bodyCommission, totalAmount: bodyTotal } = req.body;

    if (!mpesaCode || mpesaCode.trim().length < 8) {
      return res.status(400).json({ success: false, message: 'Please enter your M-Pesa confirmation code (e.g. QGH7YU89KL)' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (!['IN_PROGRESS', 'COMPLETED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Can only record cash payment for in-progress or completed bookings' });
    }
    if (booking.paymentStatus === 'PAID') {
      return res.status(400).json({ success: false, message: 'This booking was already paid via M-Pesa' });
    }

    const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
    const commission = bodyCommission || Math.round((bodyTotal || booking.totalAmount) * commissionRate);
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 24);
    const now = new Date();
    const equityMsg = mpesaCode.trim();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "Booking" SET "cashPaid" = true, "cashPaidAt" = $1, "status" = 'COMPLETED' WHERE id = $2`,
        now, bookingId
      );

      await tx.outstandingCommission.upsert({
        where: { bookingId },
        create: {
          bookingId,
          providerId: booking.providerId,
          cashAmount: booking.totalAmount || 0,
          commissionAmount: commission,
          amount: commission,
          reminderCount: 0,
          status: 'PENDING_VERIFICATION',
          mpesaRef: equityMsg,
          dueAt: dueDate,
          dueDate,
        },
        update: {
          status: 'PENDING_VERIFICATION',
          mpesaRef: equityMsg,
          dueAt: dueDate,
          dueDate,
        },
      });
    });

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '💰 Commission Payment — Verify Now!',
        body: `${booking.provider.businessName} submitted Equity Bank message for KSh ${commission} commission. Check account 0795542312 and confirm.`,
      }).catch(console.error);
    }

    console.log(`💰 Commission submitted by ${booking.provider.businessName} — KSh ${commission}`);

    res.json({
      success: true,
      data: {
        message: 'Commission payment submitted. Admin will verify within 1 hour.',
        commissionAmount: commission,
        dueDate,
      },
    });
  } catch (err) {
    console.error('markCashPaid error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── PAY COMMISSION VIA M-PESA ──────────────────────────────────────────────────
async function payCommission(req, res) {
  try {
    const commissionId = req.params.id;

    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: commissionId },
      include: { provider: { include: { user: true } } },
    });

    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });
    if (commission.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (commission.status === 'PAID') {
      return res.status(400).json({ success: false, message: 'Commission already paid' });
    }
    if (commission.status === 'WAIVED') {
      return res.status(400).json({ success: false, message: 'Commission has been waived' });
    }

    const phone = commission.provider.user.phone;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Provider phone number not found' });
    }

    const mpesaSvc = require('../services/mpesa.service');
    const stkResult = await mpesaSvc.stkPush({
      phone,
      amount: commission.amount,
      bookingId: commission.bookingId,
      accountRef: `COMM-${commissionId.slice(-6)}`,
      description: 'KaziShow Commission Payment',
      callbackUrl: `${process.env.BACKEND_URL}/api/bookings/commission-callback`,
    });

    await prisma.outstandingCommission.update({
      where: { id: commissionId },
      data: { checkoutRequestId: stkResult.CheckoutRequestID },
    });

    console.log(`💳 Commission STK Push sent to ${phone} for KSh ${commission.amount}`);

    res.json({
      success: true,
      data: {
        message: 'M-Pesa payment prompt sent to your phone',
        checkoutRequestId: stkResult.CheckoutRequestID,
      },
    });
  } catch (err) {
    console.error('❌ payCommission error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── COMMISSION M-PESA CALLBACK ─────────────────────────────────────────────────
async function commissionCallback(req, res) {
  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return res.status(400).json({ success: false, message: 'Invalid callback' });

    const { ResultCode, CheckoutRequestID } = body;

    if (ResultCode !== 0) {
      console.log(`❌ Commission payment failed: ${body.ResultDesc}`);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const commission = await prisma.outstandingCommission.findFirst({
      where: { checkoutRequestId: CheckoutRequestID },
      include: { provider: { include: { user: true } } },
    });

    if (!commission) {
      console.log(`⚠️ Commission not found for CheckoutRequestID: ${CheckoutRequestID}`);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const items = body.CallbackMetadata?.Item || [];
    const mpesaRef = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

    await prisma.outstandingCommission.update({
      where: { id: commission.id },
      data: { status: 'PAID', paidAt: new Date(), mpesaRef: mpesaRef || null },
    });

    // Notify provider
    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'PAYMENT_RECEIVED',
      title: '✅ Commission Paid — Account Unlocked!',
      body: `Your KSh ${commission.amount} commission has been received. Your account is fully active. Thank you!`,
      bookingId: commission.bookingId,
    }).catch(console.error);

    if (commission.provider.user.deviceToken) {
      const firebaseSvc = require('../services/firebase.service');
      firebaseSvc.sendPushNotification({
        deviceToken: commission.provider.user.deviceToken,
        title: '✅ Commission Paid — App Unlocked!',
        body: `KSh ${commission.amount} commission received. Your account is now fully active.`,
        data: { url: '/provider/earnings', type: 'COMMISSION_PAID' },
      }).catch(console.error);
    }

    const smsSvc = require('../services/sms.service');
    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: Commission payment of KSh ${commission.amount} received (Ref: ${mpesaRef}). Your account is now fully active. Thank you!`
    ).catch(console.error);

    console.log(`✅ Commission paid: KSh ${commission.amount} from ${commission.provider.businessName}`);

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('❌ commissionCallback error:', err.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
}

// ── GET OUTSTANDING COMMISSION (provider checks own) ──────────────────────────
async function getOutstandingCommission(req, res) {
  try {
    console.log(`💰 getOutstandingCommission for user: ${req.user.id}`);

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) {
      console.log('No provider found for user:', req.user.id);
      return res.json({ success: true, data: [] });
    }

    console.log(`💰 Provider: ${provider.businessName} (${provider.id})`);

    const commissions = await prisma.outstandingCommission.findMany({
      where: { providerId: provider.id, status: { in: ['PENDING', 'OVERDUE', 'PENDING_VERIFICATION'] } },
      include: {
        booking: {
          include: {
            service: { select: { name: true } },
            customer: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const commissionRate = parseFloat(process.env.COMMISSION_RATE || '0.10');
    const shaped = commissions.map((c) => ({
      ...c,
      commissionAmount: c.amount,
      cashAmount: commissionRate > 0 ? Math.round(c.amount / commissionRate) : c.amount * 10,
    }));

    console.log(`💰 Found ${shaped.length} commissions for ${provider.businessName}`);

    return res.json({ success: true, data: shaped });
  } catch (err) {
    console.error('❌ getOutstandingCommission error:', err.message);
    return res.json({ success: true, data: [] });
  }
}

// ── ADMIN: GET ALL COMMISSIONS ─────────────────────────────────────────────────
async function getAllCommissions(req, res) {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status.toUpperCase();

    const [commissions, total, stats] = await Promise.all([
      prisma.outstandingCommission.findMany({
        where,
        include: {
          provider: { select: { businessName: true, user: { select: { name: true, phone: true } } } },
          booking: { include: { service: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.outstandingCommission.count({ where }),
      prisma.outstandingCommission.groupBy({
        by: ['status'],
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.json({
      success: true,
      data: { commissions, total, stats },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN: WAIVE COMMISSION ────────────────────────────────────────────────────
async function waiveCommission(req, res) {
  try {
    const { reason } = req.body;
    const commissionId = req.params.id;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Waive reason is required' });
    }

    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: commissionId },
      include: { provider: { include: { user: true } } },
    });

    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });
    if (['PAID', 'WAIVED'].includes(commission.status)) {
      return res.status(400).json({ success: false, message: `Commission is already ${commission.status.toLowerCase()}` });
    }

    await prisma.outstandingCommission.update({
      where: { id: commissionId },
      data: {
        status: 'WAIVED',
        waivedAt: new Date(),
        waivedBy: req.user.id,
        waiveReason: reason,
      },
    });

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '✅ Commission Waived',
      body: `Your KSh ${commission.amount} commission has been waived by KaziShow admin. Your account is now fully active.`,
      bookingId: commission.bookingId,
    }).catch(console.error);

    console.log(`✅ Commission waived: KSh ${commission.amount} for ${commission.provider.businessName}`);

    res.json({ success: true, data: { message: 'Commission waived successfully' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN: CONFIRM COMMISSION PAYMENT ─────────────────────────────────────────
async function confirmCommissionPayment(req, res) {
  try {
    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } }, booking: { include: { service: true } } },
    });
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const serviceName = commission.booking?.service?.name || 'Service';
    const amount = commission.commissionAmount || commission.amount;

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '✅ Commission Confirmed!',
      body: `Your commission of KSh ${amount} for ${serviceName} has been confirmed. Your account is fully active. Keep getting bookings!`,
      bookingId: commission.bookingId,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: ✅ Your commission of KSh ${amount} has been confirmed! Your account is active. Keep getting bookings on kazishow.co.ke`
    ).catch(console.error);

    console.log(`✅ Commission confirmed: KSh ${amount} from ${commission.provider.businessName}`);
    res.json({ success: true, data: { message: 'Commission confirmed and Fundi notified' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── ADMIN: REJECT COMMISSION PAYMENT ──────────────────────────────────────────
async function rejectCommissionPayment(req, res) {
  try {
    const { reason } = req.body;
    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } } },
    });
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { status: 'PENDING', mpesaRef: null },
    });

    const amount = commission.commissionAmount || commission.amount;
    const rejectMsg = reason || `Please pay KSh ${amount} to Paybill 247247 Account 0795542312 and submit the correct message.`;

    notificationSvc.createNotification({
      userId: commission.provider.userId,
      type: 'SYSTEM',
      title: '❌ Commission Code Rejected',
      body: `Your Equity Bank message was not verified. ${rejectMsg}`,
      bookingId: commission.bookingId,
    }).catch(console.error);

    smsSvc.sendSMS(
      commission.provider.user.phone,
      `KaziShow: ❌ Your commission message was rejected. ${rejectMsg}`
    ).catch(console.error);

    res.json({ success: true, data: { message: 'Commission rejected and Fundi notified' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── CUSTOMER REQUESTS REFUND ──────────────────────────────────────────────────
async function requestRefund(req, res) {
  try {
    const { id: bookingId } = req.params;
    const { phone } = req.body;
    const customerId = req.user.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: { include: { user: true } },
        service: true,
      },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== customerId) {
      return res.status(403).json({ success: false, message: 'Not your booking' });
    }
    if (!['DECLINED', 'CANCELLED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Refund only available for declined or cancelled bookings' });
    }
    if (!['PAID'].includes(booking.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: ['REFUND_REQUESTED', 'REFUNDED'].includes(booking.paymentStatus)
          ? 'Refund already requested or processed'
          : 'No M-Pesa payment was made for this booking',
      });
    }

    // Mark as REFUND_REQUESTED so admin can see it in the refund queue.
    // paymentStatus stays REFUND_REQUESTED until admin sends the money,
    // then admin action sets it to REFUNDED.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'REFUND_REQUESTED' },
    });

    // Create/update cancellation record to track the pending refund
    await prisma.bookingCancellation.upsert({
      where: { bookingId },
      update: { refundStatus: 'PENDING', refundAmount: booking.totalAmount || 0 },
      create: {
        bookingId,
        cancelledBy: customerId,
        reason: 'Customer requested M-Pesa refund',
        refundAmount: booking.totalAmount || 0,
        refundStatus: 'PENDING',
      },
    });

    const refundPhone = (phone && phone.trim()) || booking.customer.phone;
    const amount = booking.totalAmount || 0;
    const serviceName = booking.service?.name || 'Service';
    const ref = bookingId.slice(-8).toUpperCase();

    // Notify customer
    notificationSvc.createNotification({
      userId: customerId,
      type: 'SYSTEM',
      title: '💸 Refund Request Received',
      body: `Your refund of KSh ${amount} for "${serviceName}" has been submitted. Expect your M-Pesa refund within 24 hours. Ref: ${ref}`,
      bookingId,
    }).catch(console.error);

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '💸 Refund Request',
        body: `${booking.customer.name} requests KSh ${amount} refund for "${serviceName}" (${booking.status}). Phone: ${refundPhone}. Ref: ${ref}`,
        bookingId,
      }).catch(console.error);
    }

    // SMS customer
    const smsSvc = require('../services/sms.service');
    smsSvc.sendSMS(
      refundPhone,
      `KaziShow: Refund request of KSh ${amount} for "${serviceName}" received. You will receive an M-Pesa payment within 24 hours. Ref: ${ref}`
    ).catch(console.error);

    console.log(`💸 Refund requested: KSh ${amount} for booking ${bookingId} → ${refundPhone}`);

    res.json({
      success: true,
      data: {
        message: `Refund of KSh ${amount} will be sent to ${refundPhone} within 24 hours`,
        amount,
        phone: refundPhone,
      },
    });
  } catch (err) {
    console.error('❌ requestRefund error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── CUSTOMER DISPUTES JOB ─────────────────────────────────────────────────────
async function disputeJob(req, res) {
  try {
    const { reason } = req.body;
    const bookingId = req.params.id;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a detailed reason (at least 10 characters)',
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: { include: { user: true } },
        service: true,
      },
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only the customer can dispute this job' });
    }
    if (booking.status !== 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Can only dispute completed bookings' });
    }
    if (booking.customerConfirmed) {
      return res.status(400).json({ success: false, message: 'Cannot dispute a job you already confirmed' });
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'DISPUTED' },
    });

    // Create report record (using correct field names)
    await prisma.report.create({
      data: {
        reporterId: req.user.id,
        reportedId: booking.provider.userId,
        type: 'OTHER',
        description: `JOB_DISPUTE: ${reason}`,
        bookingId,
      },
    }).catch(() => console.log('Could not create report record'));

    const smsSvc = require('../services/sms.service');
    const firebaseSvc = require('../services/firebase.service');

    // Notify all admins immediately
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '🚨 Job Dispute — Action Required!',
        body: `${booking.customer.name} disputed job by ${booking.provider.businessName}. Service: ${booking.service?.name}. Amount: KSh ${booking.totalAmount}. Reason: ${reason}`,
        bookingId,
      }).catch(console.error);

      if (admin.deviceToken) {
        firebaseSvc.sendPushNotification({
          deviceToken: admin.deviceToken,
          title: '🚨 Job Dispute Needs Review!',
          body: `${booking.customer.name} vs ${booking.provider.businessName} — KSh ${booking.totalAmount}`,
          data: { url: '/admin', bookingId, type: 'DISPUTE' },
        }).catch(console.error);
      }
    }

    // Notify provider
    notificationSvc.createNotification({
      userId: booking.provider.userId,
      type: 'SYSTEM',
      title: '⚠️ Customer Disputed Your Job',
      body: `${booking.customer.name} disputed the job completion. Reason: ${reason}. KaziShow admin will review and resolve this.`,
      bookingId,
    }).catch(console.error);

    smsSvc.sendSMS(
      booking.provider.user.phone,
      `KaziShow: ${booking.customer.name} disputed job completion. Reason: ${reason}. Admin will review. Payment held until resolved.`
    ).catch(console.error);

    smsSvc.sendSMS(
      booking.customer.phone,
      `KaziShow: Your dispute has been submitted. Admin will review and resolve within 24 hours. Payment of KSh ${booking.totalAmount} is held safely.`
    ).catch(console.error);

    console.log(`🚨 Job dispute created: ${bookingId} by ${booking.customer.name}`);

    res.json({
      success: true,
      data: { message: 'Dispute submitted. Admin will review within 24 hours. Payment is held safely.' },
    });
  } catch (err) {
    console.error('❌ disputeJob error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET COMMISSION FOR PAYMENT PAGE ───────────────────────────────────────────
async function getCommissionForPayment(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const commissions = await prisma.outstandingCommission.findMany({
      where: { providerId: provider.id, status: { in: ['PENDING', 'OVERDUE', 'PENDING_VERIFICATION'] } },
      include: {
        booking: {
          include: {
            service: { select: { name: true } },
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || '0.10');
    const shaped = commissions.map((c) => ({
      ...c,
      commissionAmount: c.amount,
      cashAmount: COMMISSION_RATE > 0 ? Math.round(c.amount / COMMISSION_RATE) : 0,
    }));

    res.json({ success: true, data: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── SUBMIT M-PESA CODE FOR COMMISSION ─────────────────────────────────────────
async function submitCommissionCode(req, res) {
  try {
    const { mpesaCode } = req.body;
    if (!mpesaCode) return res.status(400).json({ success: false, message: 'M-Pesa code is required' });

    const commission = await prisma.outstandingCommission.findUnique({
      where: { id: req.params.id },
      include: {
        provider: { include: { user: true } },
        booking: { include: { service: { select: { name: true } } } },
      },
    });
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });
    if (commission.provider.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.outstandingCommission.update({
      where: { id: req.params.id },
      data: { mpesaRef: mpesaCode, status: 'PENDING_VERIFICATION' },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      await notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '💰 Commission Payment Submitted',
        body: `${commission.provider.businessName} submitted M-Pesa code ${mpesaCode} for commission of KSh ${commission.amount}. Please verify and confirm.`,
      });
    }

    res.json({ success: true, data: { message: 'Payment code submitted. Admin will verify within 1 hour.' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getCommissionStatus(req, res) {
  try {
    const { bookingId } = req.params;
    const commission = await prisma.outstandingCommission.findUnique({
      where: { bookingId },
      select: {
        id: true,
        status: true,
        mpesaRef: true,
        commissionAmount: true,
        paidAt: true,
      },
    });
    res.json({ success: true, data: commission || null });
  } catch (err) {
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
  confirmJobComplete,
  releasePaymentToProvider,
  getCancellationStats,
  getTracking,
  updateProviderLocation,
  notifyWaitlist,
  markCashPaid,
  payCommission,
  commissionCallback,
  getOutstandingCommission,
  getAllCommissions,
  waiveCommission,
  disputeJob,
  requestRefund,
  markRefundProcessed,
  sendB2CRefund,
  getCommissionForPayment,
  submitCommissionCode,
  confirmCommissionPayment,
  rejectCommissionPayment,
  getCommissionStatus,
};
