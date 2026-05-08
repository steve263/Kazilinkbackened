const prisma = require('../config/db');
const socketSvc = require('./socket.service');
const smsSvc = require('./sms.service');
const emailSvc = require('./email.service');
const pushSvc = require('./firebase.service');

// In-memory map of bookingId -> setTimeout handle for the 30-second auto-decline
const declineTimers = new Map();

// ─── Core DB helper ────────────────────────────────────────────────────────────

async function createNotification({ userId, type, title, body, bookingId }) {
  const notif = await prisma.notification.create({
    data: { userId, type, title, body, bookingId },
  });
  socketSvc.emitToUser(userId, 'new_notification', { id: notif.id, type, title });
  return notif;
}

// ─── New booking (provider) ────────────────────────────────────────────────────

async function notifyNewBooking({ booking, providerUser, customerUser }) {
  const serviceName = booking.service?.name || 'Service';
  const providerName = booking.provider?.businessName || providerUser.name;

  // 1. Real-time socket to provider
  socketSvc.emitNewBooking(providerUser.id, {
    booking,
    customer: { name: customerUser.name, phone: customerUser.phone },
  });

  // 2. Persist notification for provider
  await createNotification({
    userId: providerUser.id,
    type: 'NEW_BOOKING',
    title: 'New Booking Request',
    body: `${customerUser.name} wants ${serviceName} at ${booking.address} — KSh ${booking.totalAmount}`,
    bookingId: booking.id,
  });


  // 3. Push notification to provider
  pushSvc.sendPushNotification({
    deviceToken: providerUser.deviceToken,
    title: '📅 New Booking Request!',
    body: `${customerUser.name} wants ${serviceName} · KSh ${booking.totalAmount}`,
    emoji: '📅',
    data: { url: '/provider/notifications', bookingId: booking.id, type: 'NEW_BOOKING' },
  }).catch(console.error);

  // 4. SMS to provider
  smsSvc
    .sendSMS(
      providerUser.phone,
      smsSvc.tplNewBookingProvider(customerUser.name, serviceName, booking.address, booking.totalAmount)
    )
    .catch(console.error);

  // 4. Email to provider if they have an email and are offline
  if (!providerUser.isOnline) {
    emailSvc.sendEmail({
      to: providerUser.email,
      subject: `🔔 New Booking Request — ${serviceName}`,
      html: emailSvc.tplNewBooking({
        providerName: providerUser.name,
        customerName: customerUser.name,
        service: serviceName,
        location: booking.address,
        amount: booking.totalAmount,
        scheduledDate: booking.scheduledDate ? new Date(booking.scheduledDate).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }) : null,
      }),
    }).catch(console.error);
  }

  // 4. 30-second auto-decline timer
  const timer = setTimeout(async () => {
    try {
      const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
      if (fresh && fresh.status === 'PENDING') {
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DECLINED' } });
        console.log(`⏰ Booking ${booking.id} auto-declined (no response in 30 s)`);

        socketSvc.emitBookingDeclined(customerUser.id, {
          bookingId: booking.id,
          reason: 'Provider did not respond in time',
        });

        await createNotification({
          userId: customerUser.id,
          type: 'BOOKING_DECLINED',
          title: 'Booking Not Accepted',
          body: 'Your request timed out. Please try another provider.',
          bookingId: booking.id,
        });

        pushSvc.sendPushNotification({
          deviceToken: customerUser.deviceToken,
          title: '⏰ Booking Timed Out',
          body: 'Provider did not respond. Please try another provider.',
          emoji: '⏰',
          data: { url: '/discover', type: 'BOOKING_DECLINED' },
        }).catch(console.error);

        smsSvc
          .sendSMS(customerUser.phone, smsSvc.tplBookingDeclinedCustomer(providerUser.name))
          .catch(console.error);
      }
    } catch (err) {
      console.error('❌ Auto-decline error:', err.message);
    }
    declineTimers.delete(booking.id);
  }, 30_000);

  declineTimers.set(booking.id, timer);
}

// ─── Booking accepted (customer) ───────────────────────────────────────────────

async function notifyBookingAccepted({ booking, customerUser, providerName }) {
  cancelDeclineTimer(booking.id);

  socketSvc.emitBookingAccepted(customerUser.id, { booking, providerName });

  await createNotification({
    userId: customerUser.id,
    type: 'BOOKING_ACCEPTED',
    title: 'Booking Accepted!',
    body: `${providerName} accepted your booking and is on the way.`,
    bookingId: booking.id,
  });

  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title: '✅ Booking Accepted!',
    body: `${providerName} accepted your request and is on the way!`,
    emoji: '✅',
    data: { url: '/profile', bookingId: booking.id, type: 'BOOKING_ACCEPTED' },
  }).catch(console.error);

  smsSvc
    .sendSMS(customerUser.phone, smsSvc.tplBookingAcceptedCustomer(providerName, booking.scheduledTime))
    .catch(console.error);
}

// ─── Booking declined (customer) ───────────────────────────────────────────────

async function notifyBookingDeclined({ booking, customerUser, providerName }) {
  cancelDeclineTimer(booking.id);

  socketSvc.emitBookingDeclined(customerUser.id, { booking });

  await createNotification({
    userId: customerUser.id,
    type: 'BOOKING_DECLINED',
    title: 'Booking Declined',
    body: `${providerName} declined your request. Try another provider.`,
    bookingId: booking.id,
  });

  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title: '❌ Booking Declined',
    body: `${providerName} is not available. Try another provider.`,
    emoji: '❌',
    data: { url: '/discover', bookingId: booking.id, type: 'BOOKING_DECLINED' },
  }).catch(console.error);

  smsSvc
    .sendSMS(customerUser.phone, smsSvc.tplBookingDeclinedCustomer(providerName))
    .catch(console.error);
}

// ─── Payment received (both parties) ──────────────────────────────────────────

async function notifyPaymentReceived({ booking, customerUser, providerUserId, providerDeviceToken, amount, mpesaRef }) {
  // Socket to provider
  socketSvc.emitPaymentReceived(providerUserId, { bookingId: booking.id, amount, mpesaRef });

  // Notification + SMS for customer
  await createNotification({
    userId: customerUser.id,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment Confirmed',
    body: `KSh ${amount} received. Ref: ${mpesaRef}`,
    bookingId: booking.id,
  });

  // Push to customer
  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title: '💚 Payment Confirmed!',
    body: `KSh ${amount} received. Ref: ${mpesaRef}`,
    emoji: '💚',
    data: { url: '/profile', type: 'PAYMENT_RECEIVED' },
  }).catch(console.error);

  // Push to provider
  pushSvc.sendPushNotification({
    deviceToken: providerDeviceToken,
    title: '💰 Payment Received!',
    body: `KSh ${amount} received for your service. Ref: ${mpesaRef}`,
    emoji: '💰',
    data: { url: '/provider/notifications', type: 'PAYMENT_RECEIVED' },
  }).catch(console.error);

  smsSvc
    .sendSMS(customerUser.phone, smsSvc.tplPaymentConfirmed(amount, mpesaRef))
    .catch(console.error);
}

// ─── Status updates (customer) ─────────────────────────────────────────────────

async function notifyStatusUpdate({ booking, customerUser, status, providerName, providerUserId, totalAmount }) {
  if (status === 'EN_ROUTE') {
    socketSvc.emitProviderEnRoute(customerUser.id, { booking, providerName });
    await createNotification({
      userId: customerUser.id,
      type: 'SYSTEM',
      title: `${providerName} is on the way 🚗`,
      body: `Your provider is heading to your location. Get ready!`,
      bookingId: booking.id,
    });
    smsSvc.sendSMS(customerUser.phone, smsSvc.tplProviderEnRoute(providerName)).catch(console.error);
  } else if (status === 'ARRIVED') {
    socketSvc.emitProviderArrived(customerUser.id, { booking, providerName });
    await createNotification({
      userId: customerUser.id,
      type: 'SYSTEM',
      title: `${providerName} has arrived 📍`,
      body: `Your provider is at your location. Please come out or let them in.`,
      bookingId: booking.id,
    });
  } else if (status === 'IN_PROGRESS') {
    socketSvc.emitToUser(customerUser.id, 'booking_in_progress', { booking, providerName });
    await createNotification({
      userId: customerUser.id,
      type: 'SYSTEM',
      title: 'Job in Progress ▶',
      body: `${providerName} has started your job. You'll be notified when it's done.`,
      bookingId: booking.id,
    });
    smsSvc.sendSMS(customerUser.phone, `KaziShow: ${providerName} has started your job. You'll be notified when complete.`).catch(console.error);
  } else if (status === 'COMPLETED') {
    await notifyJobCompleted({ booking, customerUser, providerName, providerUserId, totalAmount });
  }
}

// ─── Job completed (customer + provider) ──────────────────────────────────────

async function notifyJobCompleted({ booking, customerUser, providerName, providerUserId, totalAmount }) {
  // Notify customer
  socketSvc.emitToUser(customerUser.id, 'booking_completed', { booking, providerName });

  await createNotification({
    userId: customerUser.id,
    type: 'BOOKING_COMPLETED',
    title: 'Job Complete!',
    body: `Your job is done. Please rate ${providerName}.`,
    bookingId: booking.id,
  });

  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title: '🎉 Job Complete!',
    body: `Your job with ${providerName} is done. Please leave a review!`,
    emoji: '🎉',
    data: { url: '/profile', bookingId: booking.id, type: 'BOOKING_COMPLETED' },
  }).catch(console.error);

  smsSvc
    .sendSMS(customerUser.phone, smsSvc.tplJobCompletedCustomer(providerName))
    .catch(console.error);

  // Notify provider
  if (providerUserId) {
    socketSvc.emitToUser(providerUserId, 'job_completed', { booking, amount: totalAmount });

    await createNotification({
      userId: providerUserId,
      type: 'BOOKING_COMPLETED',
      title: 'Payment Released',
      body: `KSh ${totalAmount} will be sent to your M-Pesa shortly.`,
      bookingId: booking.id,
    });

    smsSvc
      .sendSMS(booking.provider?.user?.phone || '', smsSvc.tplJobCompletedProvider(totalAmount))
      .catch(console.error);
  }
}

// ─── New order — business auto-accept flow ─────────────────────────────────────

async function notifyNewOrder({ booking, providerUser, customerUser }) {
  const serviceName = booking.service?.name || 'Service';
  const providerName = booking.provider?.businessName || providerUser.name;

  // Real-time to business owner — they must manually accept/decline within 20s
  socketSvc.emitToUser(providerUser.id, 'new_order', {
    booking,
    customer: { name: customerUser.name, phone: customerUser.phone },
  });

  // DB notification for provider
  await createNotification({
    userId: providerUser.id,
    type: 'NEW_BOOKING',
    title: `New Order from ${customerUser.name}`,
    body: `${serviceName} — KSh ${booking.totalAmount}. Respond within 20 seconds.`,
    bookingId: booking.id,
  });

  // Push to provider
  pushSvc.sendPushNotification({
    deviceToken: providerUser.deviceToken,
    title: '🛒 New Order!',
    body: `${customerUser.name} — ${serviceName} · KSh ${booking.totalAmount}. Respond within 20s.`,
    emoji: '🛒',
    data: { url: '/provider/notifications', bookingId: booking.id, type: 'NEW_BOOKING' },
  }).catch(console.error);

  // SMS to provider
  smsSvc.sendSMS(
    providerUser.phone,
    smsSvc.tplNewOrderBusiness(customerUser.name, serviceName, booking.totalAmount)
  ).catch(console.error);

  // Email to provider if offline
  if (!providerUser.isOnline) {
    emailSvc.sendEmail({
      to: providerUser.email,
      subject: `🔔 New Order Request — ${serviceName}`,
      html: emailSvc.tplNewBooking({
        providerName: providerUser.name,
        customerName: customerUser.name,
        service: serviceName,
        location: booking.address,
        amount: booking.totalAmount,
        scheduledDate: booking.scheduledDate
          ? new Date(booking.scheduledDate).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })
          : null,
      }),
    }).catch(console.error);
  }

  // 20-second auto-decline timer
  const timer = setTimeout(async () => {
    try {
      const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
      if (fresh && fresh.status === 'PENDING') {
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DECLINED' } });
        console.log(`⏰ Order ${booking.id} auto-declined (business no response in 20s)`);

        socketSvc.emitBookingDeclined(customerUser.id, {
          bookingId: booking.id,
          reason: 'Provider did not respond in time',
        });

        await createNotification({
          userId: customerUser.id,
          type: 'BOOKING_DECLINED',
          title: 'Booking Not Accepted',
          body: 'Your request timed out. Please try another provider.',
          bookingId: booking.id,
        });

        smsSvc.sendSMS(customerUser.phone, smsSvc.tplBookingDeclinedCustomer(providerName)).catch(console.error);
      }
    } catch (err) {
      console.error('❌ Business auto-decline error:', err.message);
    }
    declineTimers.delete(booking.id);
  }, 20_000);

  declineTimers.set(booking.id, timer);
}

// ─── Order status updates — business flow ──────────────────────────────────────

async function notifyOrderStatusUpdate({ booking, customerUser, status, providerName }) {
  const STATUS_MAP = {
    PREPARING: {
      title: 'Order Being Prepared 👨‍🍳',
      body: `${providerName} is preparing your order. We'll notify you when it's ready.`,
      sms: smsSvc.tplOrderPreparingCustomer(providerName),
    },
    READY: {
      title: 'Order Ready! 🎉',
      body: `Your order at ${providerName} is ready! Please proceed.`,
      sms: smsSvc.tplOrderReadyCustomer(providerName),
    },
    COMPLETED: {
      title: 'Order Complete ✅',
      body: `Your order at ${providerName} is complete. Thank you! Please leave a review.`,
      sms: smsSvc.tplOrderCompletedCustomer(providerName),
    },
  };

  const meta = STATUS_MAP[status] || { title: 'Order Updated', body: `Your order status: ${status}`, sms: null };

  socketSvc.emitToUser(customerUser.id, 'order_status_update', { booking, status, providerName });

  await createNotification({
    userId: customerUser.id,
    type: status === 'COMPLETED' ? 'BOOKING_COMPLETED' : 'SYSTEM',
    title: meta.title,
    body: meta.body,
    bookingId: booking.id,
  });

  if (meta.sms) smsSvc.sendSMS(customerUser.phone, meta.sms).catch(console.error);
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function cancelDeclineTimer(bookingId) {
  const t = declineTimers.get(bookingId);
  if (t) {
    clearTimeout(t);
    declineTimers.delete(bookingId);
    console.log(`⏹️ Cancelled decline timer for booking ${bookingId}`);
  }
}

module.exports = {
  createNotification,
  notifyNewBooking,
  notifyNewOrder,
  notifyBookingAccepted,
  notifyBookingDeclined,
  notifyJobCompleted,
  notifyOrderStatusUpdate,
  notifyPaymentReceived,
  notifyStatusUpdate,
  cancelDeclineTimer,
};
