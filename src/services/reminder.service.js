const cron = require('node-cron');
const prisma = require('../config/db');
const smsSvc = require('./sms.service');
const notifSvc = require('./notification.service');
const pushSvc = require('./firebase.service');
const emailSvc = require('./email.service');

// ── Parse booking's actual datetime from date + time string ───────────────────

function getBookingMs(scheduledDate, scheduledTime) {
  const [h, m] = (scheduledTime || '08:00').split(':').map(Number);
  const d = new Date(scheduledDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
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

      // 24-hour window: 23h 25min → 24h 35min  (centre = 24h, ±35min)
      const b24 = await getBookingsInWindow(23 * 60 + 25, 24 * 60 + 35);
      for (const b of b24) {
        await sendCustomerReminder(b, 24);
        await sendProviderReminder(b, 24);
      }
      if (b24.length) console.log(`⏰ 24h reminders sent for ${b24.length} booking(s)`);

      // 1-hour window: 55min → 65min
      const b1h = await getBookingsInWindow(55, 65);
      for (const b of b1h) {
        await sendCustomerReminder(b, 1);
        await sendProviderReminder(b, 1);
      }
      if (b1h.length) console.log(`⏰ 1h reminders sent for ${b1h.length} booking(s)`);

      // 30-minute window: 25min → 35min
      const b30 = await getBookingsInWindow(25, 35);
      for (const b of b30) {
        await sendCustomerReminder(b, 0.5);
        await sendProviderReminder(b, 0.5);
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
}

module.exports = { initReminders, sendCustomerReminder, sendProviderReminder };
