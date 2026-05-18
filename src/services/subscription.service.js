const prisma = require('../config/db');
const smsSvc = require('./sms.service');
const notificationSvc = require('./notification.service');
const pushSvc = require('./firebase.service');

const PLAN_PRICES = {
  STARTER: 800,
  GROWTH: 1200,
  PREMIUM: 1500,
};

const PLAN_FEATURES = {
  STARTER: {
    name: 'Starter',
    price: 800,
    emoji: '🌱',
    features: [
      'Listed on KaziShow',
      'Unlimited bookings',
      'Customer reviews',
      'SMS notifications',
      'Basic analytics',
    ],
  },
  GROWTH: {
    name: 'Growth',
    price: 1200,
    emoji: '🚀',
    features: [
      'Everything in Starter',
      'Featured in search results',
      'Priority customer support',
      'Advanced analytics',
      'Booking reminders',
    ],
  },
  PREMIUM: {
    name: 'Premium',
    price: 1500,
    emoji: '👑',
    features: [
      'Everything in Growth',
      'Top position in search',
      'Social media promotion',
      'Dedicated account manager',
      'Custom profile badge',
    ],
  },
};

async function createFreeTrial(providerId) {
  try {
    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    const subscription = await prisma.subscription.upsert({
      where: { providerId },
      create: {
        providerId,
        plan: 'STARTER',
        status: 'TRIAL',
        trialStartDate,
        trialEndDate,
      },
      update: {},
    });

    console.log(`🎁 Free trial created for provider ${providerId} — expires ${trialEndDate.toDateString()}`);
    return subscription;
  } catch (err) {
    console.error('❌ createFreeTrial error:', err.message);
  }
}

async function isSubscriptionActive(providerId) {
  try {
    const now = new Date();
    let sub = await prisma.subscription.findUnique({ where: { providerId } });

    // No subscription at all — auto-create a free trial so new businesses can receive bookings
    if (!sub) {
      console.log(`🎁 No subscription found for provider ${providerId} — auto-creating free trial`);
      sub = await createFreeTrial(providerId);
      return true;
    }

    if (sub.status === 'TRIAL') {
      const active = new Date(sub.trialEndDate) > now;
      console.log(`🎁 Trial check [${providerId}]: ${active ? 'ACTIVE' : 'EXPIRED'} — ends ${sub.trialEndDate}`);
      return active;
    }

    if (sub.status === 'ACTIVE') {
      if (!sub.currentPeriodEnd) return true;
      const active = new Date(sub.currentPeriodEnd) > now;
      console.log(`💳 Sub check [${providerId}]: ${active ? 'ACTIVE' : 'EXPIRED'}`);
      return active;
    }

    console.log(`❌ Sub inactive [${providerId}]: ${sub.status}`);
    return false;
  } catch (err) {
    console.error('❌ isSubscriptionActive error:', err.message);
    return true; // fail open — don't block customers if the check itself errors
  }
}

async function getDaysRemaining(providerId) {
  try {
    const sub = await prisma.subscription.findUnique({ where: { providerId } });
    if (!sub) return 0;

    const now = new Date();
    if (sub.status === 'TRIAL') {
      return Math.max(0, Math.ceil((sub.trialEndDate - now) / (1000 * 60 * 60 * 24)));
    }
    if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
      return Math.max(0, Math.ceil((sub.currentPeriodEnd - now) / (1000 * 60 * 60 * 24)));
    }
    return 0;
  } catch {
    return 0;
  }
}

async function activateSubscription(providerId, plan, mpesaRef, phone) {
  const now = new Date();
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  const subscription = await prisma.subscription.update({
    where: { providerId },
    data: {
      plan,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      amount: PLAN_PRICES[plan],
      mpesaRef,
    },
    include: { provider: { include: { user: true } } },
  });

  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: subscription.id,
      amount: PLAN_PRICES[plan],
      mpesaRef,
      phone,
      status: 'PAID',
      paidAt: now,
    },
  });

  const expiry = periodEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });

  notificationSvc.createNotification({
    userId: subscription.provider.userId,
    type: 'SYSTEM',
    title: '✅ Subscription Activated!',
    body: `Your ${PLAN_FEATURES[plan].name} plan is now active until ${expiry}. Keep getting bookings!`,
  }).catch(console.error);

  smsSvc.sendSMS(
    subscription.provider.user.phone,
    `KaziShow: Your ${PLAN_FEATURES[plan].name} subscription (KSh ${PLAN_PRICES[plan]}/month) is now active until ${periodEnd.toLocaleDateString('en-KE')}. Ref: ${mpesaRef}. Keep getting bookings!`
  ).catch(console.error);

  console.log(`✅ Subscription activated: ${subscription.provider.businessName} — ${plan} — KSh ${PLAN_PRICES[plan]}`);
  return subscription;
}

async function sendExpiryReminders() {
  try {
    const now = new Date();
    const DAY = 24 * 60 * 60 * 1000;

    const include = { provider: { include: { user: true } } };

    // ── Helper: send all three channels ───────────────────────────────────────
    async function remind(sub, title, body, smsText) {
      await notificationSvc.createNotification({
        userId: sub.provider.userId,
        type: 'SYSTEM',
        title,
        body,
      }).catch(console.error);

      await pushSvc.sendPushNotification({
        deviceToken: sub.provider.user.deviceToken,
        title,
        body,
        data: { url: '/provider/subscription', type: 'SUBSCRIPTION_REMINDER' },
      }).catch(console.error);

      await smsSvc.sendSMS(sub.provider.user.phone, smsText).catch(console.error);
    }

    // ── TRIAL REMINDERS ───────────────────────────────────────────────────────

    // 4 days remaining
    const trial4 = await prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndDate: { gte: new Date(now.getTime() + 3 * DAY), lte: new Date(now.getTime() + 4 * DAY) } },
      include,
    });
    for (const sub of trial4) {
      const name = sub.provider.user.name;
      await remind(sub,
        '⏰ 4 Days Left in Free Trial!',
        `Hi ${name}! Your KaziShow free trial ends in 4 days. Subscribe from KSh 800/month to keep receiving bookings. Don't lose your customers!`,
        `KaziShow: Hi ${name}! Your FREE trial ends in 4 days. Subscribe from KSh 800/month to keep receiving bookings. Open the app now to subscribe.`,
      );
      console.log(`⏰ 4-day trial reminder sent to ${sub.provider.businessName}`);
    }

    // 2 days remaining
    const trial2 = await prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndDate: { gte: new Date(now.getTime() + 1 * DAY), lte: new Date(now.getTime() + 2 * DAY) } },
      include,
    });
    for (const sub of trial2) {
      const name = sub.provider.user.name;
      await remind(sub,
        '🚨 Only 2 Days Left in Free Trial!',
        `${name}, your KaziShow free trial ends in 2 days! Subscribe now from KSh 800/month to continue receiving bookings. Tap to subscribe!`,
        `KaziShow: URGENT! Your FREE trial ends in 2 days. Subscribe now from KSh 800/month to keep your business visible. Open the app: kazishow.co.ke`,
      );
      console.log(`🚨 2-day trial reminder sent to ${sub.provider.businessName}`);
    }

    // Last day
    const trialLast = await prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndDate: { gte: now, lte: new Date(now.getTime() + 1 * DAY) } },
      include,
    });
    for (const sub of trialLast) {
      const name = sub.provider.user.name;
      await remind(sub,
        '🔴 Last Day of Free Trial!',
        `Today is the last day of your KaziShow free trial, ${name}! Subscribe before midnight to avoid interruption. Starting at just KSh 800/month.`,
        `KaziShow: TODAY is the last day of your free trial, ${name}! Subscribe now from KSh 800/month to keep receiving bookings tomorrow. Open the app now!`,
      );
      console.log(`🔴 Last-day trial reminder sent to ${sub.provider.businessName}`);
    }

    // ── PAID SUBSCRIPTION REMINDERS ───────────────────────────────────────────

    // 7 days remaining
    const sub7 = await prisma.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { gte: new Date(now.getTime() + 6 * DAY), lte: new Date(now.getTime() + 7 * DAY) } },
      include,
    });
    for (const sub of sub7) {
      const planName = PLAN_FEATURES[sub.plan].name;
      const price = PLAN_PRICES[sub.plan];
      await remind(sub,
        `⏰ 7 Days Left on ${planName} Plan`,
        `Your KaziShow ${planName} subscription renews in 7 days. Make sure you have KSh ${price} ready to keep receiving bookings without interruption!`,
        `KaziShow: Your ${planName} subscription expires in 7 days. Renew for KSh ${price}/month to keep receiving bookings. Open the app to renew.`,
      );
      console.log(`⏰ 7-day sub reminder sent to ${sub.provider.businessName}`);
    }

    // 3 days remaining
    const sub3 = await prisma.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { gte: new Date(now.getTime() + 2 * DAY), lte: new Date(now.getTime() + 3 * DAY) } },
      include,
    });
    for (const sub of sub3) {
      const planName = PLAN_FEATURES[sub.plan].name;
      const price = PLAN_PRICES[sub.plan];
      await remind(sub,
        '🚨 3 Days Left — Renew Now!',
        `Your ${planName} plan expires in 3 days! Renew for KSh ${price}/month to avoid losing customers. Tap to renew now.`,
        `KaziShow: RENEW NOW! Your ${planName} plan expires in 3 days. Pay KSh ${price} to keep your business active on KaziShow. Open app to renew.`,
      );
      console.log(`🚨 3-day sub reminder sent to ${sub.provider.businessName}`);
    }

    // Last day
    const subLast = await prisma.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + 1 * DAY) } },
      include,
    });
    for (const sub of subLast) {
      const planName = PLAN_FEATURES[sub.plan].name;
      const price = PLAN_PRICES[sub.plan];
      await remind(sub,
        '🔴 Last Day — Renew Today!',
        `Today is the last day of your ${planName} subscription! Renew now for KSh ${price}/month to keep receiving bookings tomorrow without any interruption.`,
        `KaziShow: TODAY is your last day on ${planName} plan! Renew now for KSh ${price}/month to stay active. Open the app immediately to renew!`,
      );
      console.log(`🔴 Last-day sub reminder sent to ${sub.provider.businessName}`);
    }

    // ── EXPIRE OVERDUE RECORDS ────────────────────────────────────────────────
    await prisma.subscription.updateMany({
      where: { status: 'TRIAL', trialEndDate: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    await prisma.subscription.updateMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
      data: { status: 'EXPIRED' },
    });

    console.log('✅ Subscription expiry check complete');
  } catch (err) {
    console.error('❌ sendExpiryReminders error:', err.message);
  }
}

module.exports = {
  createFreeTrial,
  isSubscriptionActive,
  getDaysRemaining,
  activateSubscription,
  sendExpiryReminders,
  PLAN_PRICES,
  PLAN_FEATURES,
};
