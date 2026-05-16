const prisma = require('../config/db');
const smsSvc = require('./sms.service');
const notificationSvc = require('./notification.service');

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
    const sub = await prisma.subscription.findUnique({ where: { providerId } });
    if (!sub) return false;

    const now = new Date();
    if (sub.status === 'TRIAL' && sub.trialEndDate > now) return true;
    if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) return true;
    return false;
  } catch {
    return false;
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

    // Trials expiring in 3 days
    const trialExpiringSoon = await prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndDate: {
          gte: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      },
      include: { provider: { include: { user: true } } },
    });

    for (const sub of trialExpiringSoon) {
      const daysLeft = Math.ceil((sub.trialEndDate - now) / (1000 * 60 * 60 * 24));
      notificationSvc.createNotification({
        userId: sub.provider.userId,
        type: 'SYSTEM',
        title: `⏰ Free Trial Ending in ${daysLeft} Days!`,
        body: `Your free trial ends ${daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}. Subscribe from KSh 800/month to keep receiving bookings.`,
      }).catch(console.error);
      smsSvc.sendSMS(
        sub.provider.user.phone,
        `KaziShow: Your FREE trial expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}! Subscribe from KSh 800/month to keep receiving bookings. Open the app to subscribe.`
      ).catch(console.error);
      console.log(`⏰ Trial expiry reminder sent to ${sub.provider.businessName}`);
    }

    // Subscriptions expiring in 7 days
    const subExpiringSoon = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: {
          gte: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: { provider: { include: { user: true } } },
    });

    for (const sub of subExpiringSoon) {
      smsSvc.sendSMS(
        sub.provider.user.phone,
        `KaziShow: Your ${PLAN_FEATURES[sub.plan].name} subscription expires in 7 days. Renew now to keep receiving bookings. KSh ${PLAN_PRICES[sub.plan]}/month.`
      ).catch(console.error);
    }

    // Expire overdue records
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
