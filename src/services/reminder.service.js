const cron = require('node-cron');
const prisma = require('../config/db');
const smsSvc = require('./sms.service');
const notifSvc = require('./notification.service');
const pushSvc = require('./firebase.service');
const emailSvc = require('./email.service');

// ── Parse booking's actual datetime from date + time string ───────────────────
// scheduledTime is stored as "HH:MM" in Africa/Nairobi (EAT = UTC+3).
// We reconstruct it in UTC so comparisons with Date.now() are consistent.

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

function getBookingMs(scheduledDate, scheduledTime) {
  const [h, m] = (scheduledTime || '08:00').split(':').map(Number);
  // scheduledDate from Prisma is UTC midnight of the date (e.g. 2026-05-16T00:00:00Z)
  const dayMs = new Date(scheduledDate).setUTCHours(0, 0, 0, 0);
  const eatMs = dayMs + h * 3600000 + m * 60000; // time in EAT (HH:MM of that day in Nairobi)
  return eatMs - EAT_OFFSET_MS; // convert to UTC
}

// ── In-memory deduplication: track bookings we've already reminded ─────────────
// Key: `${bookingId}:${type}` (type = '24h' | '1h' | '30m')
// Value: timestamp when reminder was sent
// Entries expire after 2 hours so memory doesn't grow unbounded.

const _sentCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function alreadySent(bookingId, type) {
  const key = `${bookingId}:${type}`;
  const sentAt = _sentCache.get(key);
  if (!sentAt) return false;
  if (Date.now() - sentAt > CACHE_TTL_MS) { _sentCache.delete(key); return false; }
  return true;
}

function markSent(bookingId, type) {
  _sentCache.set(`${bookingId}:${type}`, Date.now());
}

// ── Fetch ACCEPTED bookings whose actual time falls in [fromMin, toMin] ───────

async function getBookingsInWindow(fromMin, toMin) {
  const now = Date.now();

  // Pull a broad date window so we don't miss any
  const broadStart = new Date(now + (fromMin - 90) * 60 * 1000);
  const broadEnd   = new Date(now + (toMin   + 90) * 60 * 1000);

  const rows = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      scheduledDate: { gte: broadStart, lte: broadEnd },
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true, deviceToken: true },
      },
      provider: {
        include: {
          user: {
            select: { id: true, name: true, phone: true, email: true, deviceToken: true },
          },
        },
      },
      service: { select: { name: true } },
    },
  });

  const fromMs = now + fromMin * 60 * 1000;
  const toMs   = now + toMin   * 60 * 1000;

  return rows.filter((b) => {
    const ms = getBookingMs(b.scheduledDate, b.scheduledTime);
    return ms >= fromMs && ms <= toMs;
  });
}

// ── Label helpers ─────────────────────────────────────────────────────────────

function timeLabel(hoursLeft) {
  if (hoursLeft >= 24) return '24 hours';
  if (hoursLeft >= 1)  return `${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}`;
  return '30 minutes';
}

function formatTime(timeStr) {
  const [h, m] = (timeStr || '').split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr   = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// ── Send reminder to customer ─────────────────────────────────────────────────

async function sendCustomerReminder(booking, hoursLeft) {
  const { customer, provider, service } = booking;
  const label     = timeLabel(hoursLeft);
  const title     = `⏰ Reminder: ${label} to go!`;
  const body      = `Your booking with ${provider.businessName} is in ${label}. Time: ${formatTime(booking.scheduledTime)}. Location: ${booking.address}.`;
  const smsText   = `KaziShow Reminder: Your booking with ${provider.businessName} is in ${label}. Time: ${formatTime(booking.scheduledTime)}. Location: ${booking.address}. Be ready!`;

  // In-app notification
  await notifSvc.createNotification({
    userId:    customer.id,
    type:      'BOOKING_REMINDER',
    title,
    body,
    bookingId: booking.id,
  }).catch(console.error);

  // Push notification
  await pushSvc.sendPushNotification({
    deviceToken: customer.deviceToken,
    title,
    body,
    emoji: '⏰',
    data: { url: '/profile', type: 'BOOKING_REMINDER', bookingId: booking.id },
  }).catch(console.error);

  // SMS (always)
  await smsSvc.sendSMS(customer.phone, smsText).catch(console.error);

  // Email (24h and 1h only, not 30min)
  if (hoursLeft >= 1 && customer.email) {
    await emailSvc.sendEmail({
      to:      customer.email,
      subject: `⏰ Booking Reminder: ${label} until ${provider.businessName}`,
      html:    emailSvc.tplBookingReminder({
        name:          customer.name,
        role:          'customer',
        providerName:  provider.businessName,
        serviceName:   service?.name || 'Service',
        scheduledDate: formatDate(booking.scheduledDate),
        scheduledTime: formatTime(booking.scheduledTime),
        address:       booking.address,
        amount:        booking.totalAmount,
        label,
      }),
    }).catch(console.error);
  }

  console.log(`⏰ Customer reminder → ${customer.name} (${label} before)`);
}

// ── Send reminder to provider ─────────────────────────────────────────────────

async function sendProviderReminder(booking, hoursLeft) {
  const { customer, provider, service } = booking;
  const providerUser = provider.user;
  const label        = timeLabel(hoursLeft);
  const title        = `⏰ Job Reminder: ${label} to go!`;
  const body         = `Job with ${customer.name} in ${label}. ${service?.name || 'Service'} at ${booking.address}. Time: ${formatTime(booking.scheduledTime)}.`;
  const smsText      = `KaziShow Reminder: You have a job with ${customer.name} in ${label}. Service: ${service?.name || 'Service'}. Time: ${formatTime(booking.scheduledTime)}. Location: ${booking.address}.`;

  // In-app notification
  await notifSvc.createNotification({
    userId:    providerUser.id,
    type:      'BOOKING_REMINDER',
    title,
    body,
    bookingId: booking.id,
  }).catch(console.error);

  // Push notification
  await pushSvc.sendPushNotification({
    deviceToken: providerUser.deviceToken,
    title,
    body,
    emoji: '⏰',
    data: { url: '/provider/notifications', type: 'BOOKING_REMINDER', bookingId: booking.id },
  }).catch(console.error);

  // SMS (always)
  await smsSvc.sendSMS(providerUser.phone, smsText).catch(console.error);

  // Email (24h and 1h only)
  if (hoursLeft >= 1 && providerUser.email) {
    await emailSvc.sendEmail({
      to:      providerUser.email,
      subject: `⏰ Job Reminder: ${label} until ${customer.name}`,
      html:    emailSvc.tplBookingReminder({
        name:          providerUser.name,
        role:          'provider',
        customerName:  customer.name,
        customerPhone: customer.phone,
        serviceName:   service?.name || 'Service',
        scheduledDate: formatDate(booking.scheduledDate),
        scheduledTime: formatTime(booking.scheduledTime),
        address:       booking.address,
        amount:        booking.totalAmount,
        label,
      }),
    }).catch(console.error);
  }

  console.log(`⏰ Provider reminder → ${providerUser.name} (${label} before)`);
}

// ── Daily 8 AM summary for providers ─────────────────────────────────────────

async function sendDailySummary() {
  const today = new Date();
  const start = new Date(today.setHours(0, 0, 0, 0));
  const end   = new Date(today.setHours(23, 59, 59, 999));

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ['ACCEPTED', 'PENDING'] },
      scheduledDate: { gte: start, lte: end },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      provider: {
        include: {
          user: { select: { id: true, name: true, phone: true, deviceToken: true } },
        },
      },
      service: { select: { name: true } },
    },
  });

  // Group by provider user
  const byProvider = new Map();
  for (const b of bookings) {
    const uid = b.provider.user.id;
    if (!byProvider.has(uid)) byProvider.set(uid, { user: b.provider.user, bookings: [] });
    byProvider.get(uid).bookings.push(b);
  }

  for (const { user: providerUser, bookings: jobs } of byProvider.values()) {
    const count = jobs.length;
    const title = `📋 Good morning! ${count} job${count > 1 ? 's' : ''} today`;
    const body  = `You have ${count} booking${count > 1 ? 's' : ''} scheduled today. Stay on time!`;

    await notifSvc.createNotification({
      userId: providerUser.id,
      type:   'BOOKING_REMINDER',
      title,
      body,
    }).catch(console.error);

    await pushSvc.sendPushNotification({
      deviceToken: providerUser.deviceToken,
      title,
      body,
      emoji: '📋',
      data:  { url: '/provider/notifications', type: 'BOOKING_REMINDER' },
    }).catch(console.error);

    await smsSvc.sendSMS(
      providerUser.phone,
      `KaziShow Good morning! You have ${count} job${count > 1 ? 's' : ''} today on KaziShow. Check the app for details.`
    ).catch(console.error);

    console.log(`📋 Daily summary → ${providerUser.name} (${count} jobs today)`);
  }
}

// ── Initialize cron jobs ──────────────────────────────────────────────────────

function initReminders() {
  console.log('⏰ Booking reminder cron jobs initialised (Africa/Nairobi)');

  // ── Every 30 minutes: check 24h, 1h, 30min windows ──────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    try {
      console.log('⏰ Running reminder check…');

      // 24-hour window: 23h 52min → 24h 08min (16 min wide — fits within one 30-min cron tick)
      const b24 = await getBookingsInWindow(23 * 60 + 52, 24 * 60 + 8);
      for (const b of b24) {
        if (alreadySent(b.id, '24h')) continue;
        await sendCustomerReminder(b, 24);
        await sendProviderReminder(b, 24);
        markSent(b.id, '24h');
      }
      if (b24.length) console.log(`⏰ 24h reminders sent for ${b24.length} booking(s)`);

      // 1-hour window: 55min → 65min
      const b1h = await getBookingsInWindow(55, 65);
      for (const b of b1h) {
        if (alreadySent(b.id, '1h')) continue;
        await sendCustomerReminder(b, 1);
        await sendProviderReminder(b, 1);
        markSent(b.id, '1h');
      }
      if (b1h.length) console.log(`⏰ 1h reminders sent for ${b1h.length} booking(s)`);

      // 30-minute window: 25min → 35min
      const b30 = await getBookingsInWindow(25, 35);
      for (const b of b30) {
        if (alreadySent(b.id, '30m')) continue;
        await sendCustomerReminder(b, 0.5);
        await sendProviderReminder(b, 0.5);
        markSent(b.id, '30m');
      }
      if (b30.length) console.log(`⏰ 30min reminders sent for ${b30.length} booking(s)`);

    } catch (err) {
      console.error('❌ Reminder cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Daily 8 AM: provider job summary ────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('📋 Sending daily provider summaries…');
      await sendDailySummary();
    } catch (err) {
      console.error('❌ Daily summary cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Daily 9 AM: subscription expiry check ───────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('💳 Running subscription expiry check…');
      const subSvc = require('./subscription.service');
      await subSvc.sendExpiryReminders();
    } catch (err) {
      console.error('❌ Subscription expiry cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Hourly: auto-release payments not confirmed within 24 hours ──────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const unconfirmed = await prisma.booking.findMany({
        where: {
          status: 'COMPLETED',
          customerConfirmed: false,
          completedByProvider: { lte: oneDayAgo },
          paymentReleasedAt: null,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, deviceToken: true } },
          provider: {
            include: {
              user: { select: { id: true, name: true, phone: true, deviceToken: true } },
            },
          },
          service: { select: { name: true } },
          payment: true,
        },
      });

      for (const booking of unconfirmed) {
        console.log(`⏰ Auto-releasing payment for booking ${booking.id}`);

        await prisma.booking.update({
          where: { id: booking.id },
          data: { customerConfirmed: true, customerConfirmedAt: new Date() },
        });

        // Inline release logic to avoid circular imports
        const commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.10;
        const commission = Math.round(booking.totalAmount * commissionRate);
        const providerAmount = booking.totalAmount - commission;

        if (booking.payment) {
          await prisma.payment.update({
            where: { bookingId: booking.id },
            data: { providerAmount, commission },
          }).catch(console.error);
        }

        await prisma.provider.update({
          where: { id: booking.providerId },
          data: {
            walletBalance: { increment: providerAmount },
            totalEarned: { increment: providerAmount },
          },
        });

        await prisma.booking.update({
          where: { id: booking.id },
          data: { paymentReleasedAt: new Date() },
        });

        // Notify provider
        await notifSvc.createNotification({
          userId: booking.provider.userId,
          type: 'PAYMENT_RECEIVED',
          title: '💰 Payment Auto-Released!',
          body: `KSh ${providerAmount} has been released to your earnings for ${booking.service?.name || 'Service'}. The customer did not respond within 24 hours.`,
          bookingId: booking.id,
        }).catch(console.error);

        await smsSvc.sendSMS(
          booking.provider.user.phone,
          `KaziShow: KSh ${providerAmount} auto-released to your earnings for ${booking.service?.name || 'Service'} (${booking.customer.name}). Customer did not confirm within 24 hours.`
        ).catch(console.error);

        // Notify customer
        await notifSvc.createNotification({
          userId: booking.customer.id,
          type: 'SYSTEM',
          title: '⏰ Payment Auto-Released',
          body: `Payment of KSh ${booking.totalAmount} was automatically released to ${booking.provider.businessName} after 24 hours. Please rate your experience.`,
          bookingId: booking.id,
        }).catch(console.error);
      }

      if (unconfirmed.length > 0) {
        console.log(`⏰ Auto-released ${unconfirmed.length} payment(s)`);
      }
    } catch (err) {
      console.error('❌ Auto-release cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Hourly: mark overdue commissions and block providers ─────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();

      const overdue = await prisma.outstandingCommission.findMany({
        where: { status: 'PENDING', dueAt: { lte: now } },
        include: {
          provider: {
            include: { user: { select: { id: true, name: true, phone: true, deviceToken: true } } },
          },
        },
      });

      for (const commission of overdue) {
        await prisma.outstandingCommission.update({
          where: { id: commission.id },
          data: { status: 'OVERDUE' },
        });

        await notifSvc.createNotification({
          userId: commission.provider.userId,
          type: 'SYSTEM',
          title: '🚨 Commission Overdue — App Blocked!',
          body: `Your KSh ${commission.amount} commission is overdue. Your app is now blocked until you pay. Open the app to pay now.`,
          bookingId: commission.bookingId,
        }).catch(console.error);

        if (commission.provider.user.deviceToken) {
          const firebaseSvc = require('./firebase.service');
          firebaseSvc.sendPushNotification({
            deviceToken: commission.provider.user.deviceToken,
            title: '🚨 App Blocked — Pay Commission Now!',
            body: `KSh ${commission.amount} commission overdue. Tap to pay and unlock your account immediately.`,
            data: { url: '/provider/notifications', type: 'COMMISSION_OVERDUE' },
          }).catch(console.error);
        }

        await smsSvc.sendSMS(
          commission.provider.user.phone,
          `KaziShow URGENT: Your KSh ${commission.amount} commission is overdue. Your app is now blocked. Pay now via the app to unlock your account immediately.`
        ).catch(console.error);

        console.log(`🚨 Commission overdue: KSh ${commission.amount} for ${commission.provider.businessName}`);
      }

      if (overdue.length > 0) {
        console.log(`🚨 Marked ${overdue.length} commission(s) as overdue`);
      }
    } catch (err) {
      console.error('❌ Commission overdue cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });
}

module.exports = { initReminders, sendCustomerReminder, sendProviderReminder };
