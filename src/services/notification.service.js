const prisma = require('../config/db');
const socketSvc = require('./socket.service');
const smsSvc = require('./sms.service');
const emailSvc = require('./email.service');
const pushSvc = require('./firebase.service');

// In-memory map of bookingId -> setTimeout handle for the 30-second auto-decline
const declineTimers = new Map();

// ─── Category helpers ──────────────────────────────────────────────────────────

const MOBILE_CATEGORIES = ['FUNDI'];

const BUSINESS_MESSAGES = {
  salon:       { accepted: 'Your appointment at {name} is confirmed! Please arrive at {time}.', enRoute: null, arrived: null, inProgress: 'Your session at {name} has started. Enjoy!', completed: 'Your session at {name} is complete. Hope you look amazing! 💇' },
  barbershop:  { accepted: 'Your appointment at {name} is confirmed! Please arrive at {time}.', enRoute: null, arrived: null, inProgress: 'Your session at {name} has started. Relax and enjoy! ✂️', completed: 'Your haircut at {name} is done. Hope you love your new look! 💈' },
  hotel:       { accepted: 'Your booking at {name} is confirmed! Check-in at {time}. We look forward to hosting you.', enRoute: null, arrived: null, inProgress: 'Welcome to {name}! Enjoy your stay. 🏨', completed: 'Thank you for staying at {name}! We hope to see you again. 🌟' },
  restaurant:  { accepted: 'Your table at {name} is reserved for {time}. See you soon! 🍽️', enRoute: null, arrived: null, inProgress: 'Your order at {name} is being prepared. Enjoy your meal! 🍲', completed: 'Thank you for dining at {name}! Please leave us a review. ⭐' },
  gym:         { accepted: 'Your session at {name} is confirmed for {time}. Get ready to train! 💪', enRoute: null, arrived: null, inProgress: 'Your workout session at {name} has started. Push hard! 🏋️', completed: 'Great workout at {name}! See you next time. 💪' },
  fitness:     { accepted: 'Your fitness session at {name} is confirmed for {time}. 🏃', enRoute: null, arrived: null, inProgress: 'Your fitness session at {name} has started!', completed: 'Great session at {name}! Keep up the good work. 🏃' },
  clinic:      { accepted: 'Your appointment at {name} is confirmed for {time}. Please arrive 10 minutes early. 🏥', enRoute: null, arrived: null, inProgress: 'Your appointment at {name} is in progress.', completed: 'Your appointment at {name} is complete. Take care and get well soon! 💊' },
  hospital:    { accepted: 'Your appointment at {name} is confirmed for {time}. 🏥', enRoute: null, arrived: null, inProgress: 'Your appointment at {name} is in progress.', completed: 'Your appointment at {name} is complete. Wishing you good health! 💊' },
  school:      { accepted: 'Your enrollment at {name} is confirmed for {time}. Come ready to learn! 📚', enRoute: null, arrived: null, inProgress: 'Your class at {name} has started. Learn well! 🎓', completed: 'Your class at {name} is complete. Keep learning and growing! 📚' },
  training:    { accepted: 'Your training at {name} is confirmed for {time}. 🎓', enRoute: null, arrived: null, inProgress: 'Your training session at {name} has started!', completed: 'Your training at {name} is complete. Well done! 🏆' },
  photography: { accepted: 'Your photo session at {name} is confirmed for {time}. Dress your best! 📸', enRoute: null, arrived: null, inProgress: 'Your photo session at {name} is in progress. Smile! 📷', completed: 'Your photo session at {name} is done! Your photos will be ready soon. 🖼️' },
  studio:      { accepted: 'Your studio session at {name} is confirmed for {time}. 🎬', enRoute: null, arrived: null, inProgress: 'Your session at {name} is in progress!', completed: 'Your studio session at {name} is complete! 🎬' },
  events:      { accepted: 'Your event booking with {name} is confirmed! Our team will be in touch with details. 🎉', enRoute: null, arrived: null, inProgress: 'Your event is being set up by {name}. Exciting! 🎊', completed: 'Event completed by {name}! Hope it was amazing. 🎉' },
  catering:    { accepted: 'Your catering booking with {name} is confirmed for {time}! 🍽️', enRoute: 'The catering team from {name} is on the way with your food! 🚐', arrived: 'The catering team from {name} has arrived and is setting up! 🍲', inProgress: 'Your catering service from {name} is in progress. Food is being served! 🍽️', completed: 'Catering completed by {name}! Hope everyone enjoyed the food. 🙏' },
  security:    { accepted: 'Your security booking with {name} is confirmed for {time}. 🔒', enRoute: 'Security team from {name} is on the way. 🚔', arrived: 'Security team from {name} has arrived and is on duty. 🛡️', inProgress: 'Security team from {name} is on duty at your location. 🔒', completed: 'Security service by {name} is complete. Stay safe! 🛡️' },
  cleaning:    { accepted: 'Your cleaning booking with {name} is confirmed for {time}! 🧹', enRoute: 'Cleaning team from {name} is on the way to your location! 🚐', arrived: 'Cleaning team from {name} has arrived! 🧹', inProgress: 'Your space is being cleaned by {name}. 🧺', completed: 'Cleaning completed by {name}! Enjoy your clean space. ✨' },
  repair:      { accepted: 'Your repair booking with {name} is confirmed for {time}! 🔧', enRoute: null, arrived: null, inProgress: 'Your item is being repaired at {name}. 🔨', completed: 'Your repair at {name} is complete! Come pick up your item. 🔧' },
  shop:        { accepted: 'Your order from {name} is confirmed! It will be ready at {time}. 🛒', enRoute: null, arrived: null, inProgress: 'Your order at {name} is being prepared. 📦', completed: 'Your order from {name} is ready! Come pick it up or check for delivery. 🛍️' },
  fundi:       { accepted: '{name} accepted your booking and is on the way! 🔧', enRoute: '{name} is on the way to your location! Track them on the map. 📍', arrived: '{name} has arrived at your location! 📍', inProgress: '{name} has started working on your job. 🔨', completed: 'Job completed by {name}! Please rate your experience. ⭐' },
  default:     { accepted: 'Your booking with {name} is confirmed for {time}! ✅', enRoute: null, arrived: null, inProgress: 'Your service with {name} is in progress.', completed: 'Your service with {name} is complete! Please rate your experience. ⭐' },
};

function getBookingMessage(provider, status, scheduledTime) {
  const category = (provider?.category || 'default').toLowerCase();
  const businessName = provider?.businessName || 'Your provider';
  const desc = (provider?.description || '').toLowerCase();

  let template = BUSINESS_MESSAGES['default'];

  if (category === 'fundi') {
    template = BUSINESS_MESSAGES['fundi'];
  } else if (category === 'hotel') {
    template = BUSINESS_MESSAGES['hotel'];
  } else if (category === 'restaurant') {
    template = BUSINESS_MESSAGES['restaurant'];
  } else if (category === 'shop') {
    template = BUSINESS_MESSAGES['shop'];
  } else {
    for (const keyword of Object.keys(BUSINESS_MESSAGES)) {
      if (desc.includes(keyword) || businessName.toLowerCase().includes(keyword)) {
        template = BUSINESS_MESSAGES[keyword];
        break;
      }
    }
  }

  const message = template[status];
  if (!message) return null;
  return message
    .replace(/{name}/g, businessName)
    .replace(/{time}/g, scheduledTime || '');
}

function isMobileProvider(provider) {
  const category = (provider?.category || '').toUpperCase();
  if (MOBILE_CATEGORIES.includes(category)) return true;
  const desc = (provider?.description || '').toLowerCase();
  return desc.includes('catering') || desc.includes('security') || desc.includes('cleaning');
}

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

  const provider = booking.provider;
  const mobile = isMobileProvider(provider);
  const message = getBookingMessage(provider, 'accepted', booking.scheduledTime);
  const title = mobile ? '✅ Provider Accepted!' : '✅ Booking Confirmed!';
  const body = message || (mobile
    ? `${providerName} accepted your booking and is on the way!`
    : `Your booking at ${providerName} is confirmed for ${booking.scheduledTime || 'your scheduled time'}!`);

  socketSvc.emitBookingAccepted(customerUser.id, { booking, providerName });

  await createNotification({
    userId: customerUser.id,
    type: 'BOOKING_ACCEPTED',
    title,
    body,
    bookingId: booking.id,
  });

  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title,
    body,
    emoji: '✅',
    data: { url: '/profile', bookingId: booking.id, type: 'BOOKING_ACCEPTED' },
  }).catch(console.error);

  smsSvc.sendSMS(customerUser.phone, `KaziShow: ${body}`).catch(console.error);
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
  const provider = booking.provider;
  const mobile = isMobileProvider(provider);

  if (status === 'EN_ROUTE') {
    const message = getBookingMessage(provider, 'enRoute', booking.scheduledTime);
    if (!mobile && !message) {
      console.log(`⏭️ Skipping EN_ROUTE notification for fixed business: ${providerName}`);
      return;
    }
    const body = message || `${providerName} is on the way to your location!`;
    socketSvc.emitProviderEnRoute(customerUser.id, { booking, providerName });
    await createNotification({ userId: customerUser.id, type: 'SYSTEM', title: '🚗 On The Way!', body, bookingId: booking.id });
    pushSvc.sendPushNotification({ deviceToken: customerUser.deviceToken, title: '🚗 On The Way!', body, emoji: '🚗', data: { url: '/profile', bookingId: booking.id } }).catch(console.error);
    smsSvc.sendSMS(customerUser.phone, `KaziShow: ${body}`).catch(console.error);

  } else if (status === 'ARRIVED') {
    const message = getBookingMessage(provider, 'arrived', booking.scheduledTime);
    if (!mobile && !message) {
      console.log(`⏭️ Skipping ARRIVED notification for fixed business: ${providerName}`);
      return;
    }
    const body = message || `${providerName} has arrived at your location!`;
    socketSvc.emitProviderArrived(customerUser.id, { booking, providerName });
    await createNotification({ userId: customerUser.id, type: 'SYSTEM', title: '📍 Provider Arrived!', body, bookingId: booking.id });
    pushSvc.sendPushNotification({ deviceToken: customerUser.deviceToken, title: '📍 Provider Arrived!', body, emoji: '📍', data: { url: '/profile', bookingId: booking.id } }).catch(console.error);
    smsSvc.sendSMS(customerUser.phone, `KaziShow: ${body}`).catch(console.error);

  } else if (status === 'IN_PROGRESS') {
    const message = getBookingMessage(provider, 'inProgress', booking.scheduledTime);
    const body = message || `${providerName} has started your service.`;
    socketSvc.emitToUser(customerUser.id, 'booking_in_progress', { booking, providerName });
    await createNotification({ userId: customerUser.id, type: 'SYSTEM', title: '⚡ Service Started!', body, bookingId: booking.id });
    pushSvc.sendPushNotification({ deviceToken: customerUser.deviceToken, title: '⚡ Service Started!', body, emoji: '⚡', data: { url: '/profile', bookingId: booking.id } }).catch(console.error);
    smsSvc.sendSMS(customerUser.phone, `KaziShow: ${body}`).catch(console.error);

  } else if (status === 'COMPLETED') {
    await notifyJobCompleted({ booking, customerUser, providerName, providerUserId, totalAmount });
  }
}

// ─── Job completed (customer + provider) ──────────────────────────────────────

async function notifyJobCompleted({ booking, customerUser, providerName, providerUserId, totalAmount }) {
  const message = getBookingMessage(booking.provider, 'completed', booking.scheduledTime);
  const body = message || `Your service with ${providerName} is complete! Please rate your experience. ⭐`;

  socketSvc.emitToUser(customerUser.id, 'booking_completed', { booking, providerName });

  await createNotification({
    userId: customerUser.id,
    type: 'BOOKING_COMPLETED',
    title: '🎉 Service Complete!',
    body,
    bookingId: booking.id,
  });

  pushSvc.sendPushNotification({
    deviceToken: customerUser.deviceToken,
    title: '🎉 Service Complete!',
    body,
    emoji: '🎉',
    data: { url: '/profile', bookingId: booking.id, type: 'BOOKING_COMPLETED' },
  }).catch(console.error);

  smsSvc.sendSMS(customerUser.phone, `KaziShow: ${body}`).catch(console.error);

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
