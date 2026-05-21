const prisma = require('../config/db');
const subSvc = require('../services/subscription.service');
const notificationSvc = require('../services/notification.service');

async function getMySubscription(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    let subscription = await prisma.subscription.findUnique({
      where: { providerId: provider.id },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });

    if (!subscription) {
      await subSvc.createFreeTrial(provider.id);
      subscription = await prisma.subscription.findUnique({
        where: { providerId: provider.id },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
    }

    const isActive = await subSvc.isSubscriptionActive(provider.id);
    const daysRemaining = await subSvc.getDaysRemaining(provider.id);

    res.json({
      success: true,
      data: { subscription, isActive, daysRemaining, plans: subSvc.PLAN_FEATURES },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function submitSubscriptionCode(req, res) {
  try {
    const { plan, mpesaCode } = req.body;

    if (!mpesaCode || !plan) {
      return res.status(400).json({ success: false, message: 'Plan and M-Pesa code are required' });
    }
    if (!['STARTER', 'GROWTH', 'PREMIUM'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    const provider = await prisma.provider.findUnique({
      where: { userId: req.user.id },
      include: { user: true },
    });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const planPrices = { STARTER: 800, GROWTH: 1200, PREMIUM: 1500 };
    const amount = planPrices[plan];

    let subscription = await prisma.subscription.findUnique({ where: { providerId: provider.id } });
    if (!subscription) {
      subscription = await subSvc.createFreeTrial(provider.id);
    }

    if (subscription) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount,
          phone: provider.user.phone,
          status: 'PENDING_VERIFICATION',
          mpesaRef: mpesaCode,
        },
      });
    }

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      await notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '💳 Subscription Payment Submitted',
        body: `${provider.businessName} submitted M-Pesa code ${mpesaCode} for ${plan} plan KSh ${amount}. Please verify in Equity Bank and confirm.`,
      });
    }

    console.log(`💳 Subscription payment submitted: ${provider.businessName} — ${plan} — KSh ${amount} — code: ${mpesaCode}`);

    res.json({
      success: true,
      data: { message: 'Payment submitted! Admin will verify and activate your subscription within 1 hour.' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function subscriptionCallback(req, res) {
  try {
    const { Body } = req.body;

    // Malformed or empty callback — acknowledge and exit
    if (!Body || !Body.stkCallback) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { stkCallback } = Body;
    const { ResultCode, CallbackMetadata, CheckoutRequestID } = stkCallback;

    console.log(`💳 Subscription callback: ResultCode=${ResultCode} CheckoutRequestID=${CheckoutRequestID}`);

    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const mpesaRef = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const amount   = items.find(i => i.Name === 'Amount')?.Value;
      const phone    = items.find(i => i.Name === 'PhoneNumber')?.Value?.toString();

      console.log(`✅ Payment confirmed: ${mpesaRef} — KSh ${amount}`);

      // Find the pending payment record saved during initiation
      const payment = await prisma.subscriptionPayment.findFirst({
        where: { mpesaRef: CheckoutRequestID },
        include: { subscription: { include: { provider: true } } },
      });

      if (payment) {
        let plan = 'STARTER';
        if (amount >= 1500) plan = 'PREMIUM';
        else if (amount >= 1200) plan = 'GROWTH';

        // Activate subscription (updates Subscription row, sends SMS + notification)
        await subSvc.activateSubscription(payment.subscription.providerId, plan, mpesaRef, phone);

        // Mark the existing pending payment as paid
        await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: { status: 'PAID', mpesaRef, paidAt: new Date() },
        });

        console.log(`✅ Subscription activated: provider=${payment.subscription.providerId} plan=${plan}`);
      } else {
        console.log(`⚠️ No pending payment found for CheckoutRequestID: ${CheckoutRequestID}`);
      }
    } else {
      console.log(`❌ Payment failed or cancelled: ResultCode=${ResultCode}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('❌ Subscription callback error:', err.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
}

async function getPlans(req, res) {
  res.json({ success: true, data: subSvc.PLAN_FEATURES });
}

async function getAllSubscriptions(req, res) {
  try {
    const subscriptions = await prisma.subscription.findMany({
      include: {
        provider: {
          include: { user: { select: { name: true, phone: true } } },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: subscriptions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getSubscriptionStats(req, res) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalTrial, totalActive, totalExpired, starterCount, growthCount, premiumCount, monthlyRevenue] =
      await Promise.all([
        prisma.subscription.count({ where: { status: 'TRIAL' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        prisma.subscription.count({ where: { status: 'EXPIRED' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'STARTER' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'GROWTH' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', plan: 'PREMIUM' } }),
        prisma.subscriptionPayment.aggregate({
          where: { status: 'PAID', paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
      ]);

    res.json({
      success: true,
      data: {
        totalTrial,
        totalActive,
        totalExpired,
        starterCount,
        growthCount,
        premiumCount,
        monthlyRevenue: monthlyRevenue._sum.amount || 0,
        projectedRevenue: starterCount * 800 + growthCount * 1200 + premiumCount * 1500,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getMySubscription,
  submitSubscriptionCode,
  subscriptionCallback,
  getPlans,
  getAllSubscriptions,
  getSubscriptionStats,
};
