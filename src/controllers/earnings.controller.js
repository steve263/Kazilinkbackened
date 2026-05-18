const prisma = require('../config/db');
const notificationSvc = require('../services/notification.service');
const smsSvc = require('../services/sms.service');
const firebaseSvc = require('../services/firebase.service');

async function getEarningsSummary(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [todayEarnings, weekEarnings, monthEarnings, lastMonthEarnings, totalEarnings, pendingPayouts, completedPayouts] = await Promise.all([
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS', createdAt: { gte: startOfToday } }, _sum: { providerAmount: true }, _count: true }),
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS', createdAt: { gte: startOfWeek } }, _sum: { providerAmount: true }, _count: true }),
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS', createdAt: { gte: startOfMonth } }, _sum: { providerAmount: true }, _count: true }),
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { providerAmount: true }, _count: true }),
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS' }, _sum: { providerAmount: true, commission: true, amount: true }, _count: true }),
      prisma.payout.aggregate({ where: { providerId: provider.id, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } }, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: { providerId: provider.id, status: 'COMPLETED' }, _sum: { amount: true } }),
    ]);

    const totalEarned = totalEarnings._sum.providerAmount || 0;
    const totalPaidOut = completedPayouts._sum.amount || 0;
    const pendingPayout = pendingPayouts._sum.amount || 0;
    const availableBalance = Math.max(0, totalEarned - totalPaidOut - pendingPayout);

    const thisMonth = monthEarnings._sum.providerAmount || 0;
    const lastMonth = lastMonthEarnings._sum.providerAmount || 0;
    const growth = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

    res.json({
      success: true,
      data: {
        today: Math.round(todayEarnings._sum.providerAmount || 0),
        todayBookings: todayEarnings._count,
        thisWeek: Math.round(weekEarnings._sum.providerAmount || 0),
        thisMonth: Math.round(thisMonth),
        thisMonthBookings: monthEarnings._count,
        lastMonth: Math.round(lastMonth),
        growth,
        totalEarned: Math.round(totalEarned),
        totalCommission: Math.round(totalEarnings._sum.commission || 0),
        totalProcessed: Math.round(totalEarnings._sum.amount || 0),
        availableBalance: Math.round(availableBalance),
        pendingPayout: Math.round(pendingPayout),
        totalPaidOut: Math.round(totalPaidOut),
        totalBookings: totalEarnings._count,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getEarningsHistory(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const days = parseInt(req.query.days) || 30;
    const history = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);

      const dayEarnings = await prisma.payment.aggregate({
        where: { booking: { providerId: provider.id }, status: 'SUCCESS', createdAt: { gte: start, lte: end } },
        _sum: { providerAmount: true, commission: true },
        _count: true,
      });

      history.push({
        date: start.toISOString().split('T')[0],
        day: start.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }),
        earnings: Math.round(dayEarnings._sum.providerAmount || 0),
        commission: Math.round(dayEarnings._sum.commission || 0),
        bookings: dayEarnings._count,
      });
    }

    const transactions = await prisma.payment.findMany({
      where: { booking: { providerId: provider.id }, status: 'SUCCESS' },
      include: { booking: { include: { customer: { select: { name: true } }, service: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, data: { history, transactions } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function requestPayout(req, res) {
  try {
    const { amount, phone } = req.body;
    if (!amount || !phone) return res.status(400).json({ success: false, message: 'amount and phone are required' });

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const [totalEarned, totalPaidOut, pendingPayouts] = await Promise.all([
      prisma.payment.aggregate({ where: { booking: { providerId: provider.id }, status: 'SUCCESS' }, _sum: { providerAmount: true } }),
      prisma.payout.aggregate({ where: { providerId: provider.id, status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: { providerId: provider.id, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } }, _sum: { amount: true } }),
    ]);

    const available = (totalEarned._sum.providerAmount || 0) - (totalPaidOut._sum.amount || 0) - (pendingPayouts._sum.amount || 0);

    if (amount > available) return res.status(400).json({ success: false, message: `Insufficient balance. Available: KSh ${Math.round(available)}` });
    if (amount < 100) return res.status(400).json({ success: false, message: 'Minimum payout is KSh 100' });

    const normalizedPhone = phone.replace(/\s/g, '').replace(/^\+/, '').replace(/^0/, '254');

    const payout = await prisma.payout.create({
      data: { providerId: provider.id, amount, phone: normalizedPhone },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      await notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '💰 Payout Request',
        body: `${provider.businessName} requested KSh ${amount} payout`,
      }).catch(console.error);
    }

    await notificationSvc.createNotification({
      userId: req.user.id,
      type: 'PAYMENT_RECEIVED',
      title: '💰 Payout Requested',
      body: `Your payout of KSh ${amount} has been submitted. We will process it within 24 hours.`,
    }).catch(console.error);

    smsSvc.sendSMS(req.user.phone, `KaziShow: Your payout request of KSh ${amount} has been received. We will send it to ${phone} within 24 hours.`).catch(console.error);

    console.log(`💰 Payout requested: KSh ${amount} by ${provider.businessName}`);
    res.json({ success: true, data: payout });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyPayouts(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const payouts = await prisma.payout.findMany({
      where: { providerId: provider.id },
      orderBy: { requestedAt: 'desc' },
    });

    res.json({ success: true, data: payouts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllPayouts(req, res) {
  try {
    const payouts = await prisma.payout.findMany({
      where: req.query.status ? { status: req.query.status } : {},
      include: { provider: { include: { user: { select: { name: true, phone: true } } } } },
      orderBy: { requestedAt: 'desc' },
    });

    const pendingTotal = await prisma.payout.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
    });

    res.json({ success: true, data: { payouts, pendingTotal: Math.round(pendingTotal._sum.amount || 0) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approvePayout(req, res) {
  try {
    const payout = await prisma.payout.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', mpesaRef: req.body.mpesaRef, adminNote: req.body.adminNote, processedAt: new Date() },
      include: { provider: { include: { user: true } } },
    });

    await notificationSvc.createNotification({
      userId: payout.provider.userId,
      type: 'PAYMENT_RECEIVED',
      title: '💰 Payout Sent!',
      body: `KSh ${payout.amount} has been sent to your M-Pesa ${payout.phone}. Ref: ${req.body.mpesaRef}`,
    }).catch(console.error);

    await firebaseSvc.sendPushNotification({
      deviceToken: payout.provider.user.deviceToken,
      title: '💰 Payout Sent!',
      body: `KSh ${payout.amount} sent to your M-Pesa. Ref: ${req.body.mpesaRef}`,
      emoji: '💰',
      data: { url: '/provider/earnings' },
    }).catch(console.error);

    smsSvc.sendSMS(payout.provider.user.phone, `KaziShow: Your payout of KSh ${payout.amount} has been sent to ${payout.phone}. M-Pesa Ref: ${req.body.mpesaRef}. Thank you!`).catch(console.error);

    res.json({ success: true, data: payout });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectPayout(req, res) {
  try {
    const payout = await prisma.payout.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', adminNote: req.body.reason, processedAt: new Date() },
      include: { provider: { include: { user: true } } },
    });

    await notificationSvc.createNotification({
      userId: payout.provider.userId,
      type: 'SYSTEM',
      title: '❌ Payout Rejected',
      body: `Your payout request of KSh ${payout.amount} was rejected. Reason: ${req.body.reason}`,
    }).catch(console.error);

    smsSvc.sendSMS(payout.provider.user.phone, `KaziShow: Your payout of KSh ${payout.amount} was not processed. Reason: ${req.body.reason}. Contact support for help.`).catch(console.error);

    res.json({ success: true, data: payout });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getEarningsSummary, getEarningsHistory, requestPayout, getMyPayouts, getAllPayouts, approvePayout, rejectPayout };
