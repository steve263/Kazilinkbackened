const prisma = require('../config/db');
const mpesaSvc = require('../services/mpesa.service');
const subSvc = require('../services/subscription.service');

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

async function initiateSubscription(req, res) {
  try {
    const { plan, phone } = req.body;

    if (!plan || !phone) {
      return res.status(400).json({ success: false, message: 'plan and phone are required' });
    }
    if (!['STARTER', 'GROWTH', 'PREMIUM'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const amount = subSvc.PLAN_PRICES[plan];
    const normalPhone = phone.replace(/\s/g, '').replace(/^\+/, '').replace(/^0/, '254');

    const result = await mpesaSvc.stkPush({
      phone: normalPhone,
      amount,
      bookingId: `SUB-${provider.id.slice(0, 8)}-${plan}`,
      description: `KaziShow ${plan} Subscription - KSh ${amount}/month`,
    });

    if (result.ResponseCode !== '0') {
      return res.status(400).json({ success: false, message: 'Failed to send M-Pesa prompt. Try again.' });
    }

    // Ensure subscription record exists, then save pending payment
    let subscription = await prisma.subscription.findUnique({ where: { providerId: provider.id } });
    if (!subscription) {
      subscription = await subSvc.createFreeTrial(provider.id);
    }

    if (subscription) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount,
          phone: normalPhone,
          status: 'PENDING',
          mpesaRef: result.CheckoutRequestID,
        },
      });
    }

    console.log(`💳 Subscription payment initiated: ${provider.businessName} — ${plan} — KSh ${amount}`);

    res.json({
      success: true,
      data: {
        checkoutRequestId: result.CheckoutRequestID,
        amount,
        plan,
        message: `M-Pesa prompt sent! Enter your PIN to activate ${plan} plan for KSh ${amount}/month.`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function subscriptionCallback(req, res) {
  try {
    const { Body } = req.body;
    const { stkCallback } = Body;
    const { ResultCode, CallbackMetadata, CheckoutRequestID } = stkCallback;

    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const mpesaRef = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const amount = items.find(i => i.Name === 'Amount')?.Value;
      const phone = items.find(i => i.Name === 'PhoneNumber')?.Value?.toString();

      const payment = await prisma.subscriptionPayment.findFirst({
        where: { mpesaRef: CheckoutRequestID },
        include: { subscription: { include: { provider: true } } },
      });

      if (payment) {
        let plan = 'STARTER';
        if (amount >= 1500) plan = 'PREMIUM';
        else if (amount >= 1200) plan = 'GROWTH';

        await subSvc.activateSubscription(payment.subscription.providerId, plan, mpesaRef, phone);

        await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: { status: 'PAID', mpesaRef, paidAt: new Date() },
        });

        console.log(`✅ Subscription payment confirmed: ${mpesaRef} — ${plan} — KSh ${amount}`);
      }
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
  initiateSubscription,
  subscriptionCallback,
  getPlans,
  getAllSubscriptions,
  getSubscriptionStats,
};
