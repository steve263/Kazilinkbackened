const prisma = require('../config/db');
const notificationSvc = require('./notification.service');
const smsSvc = require('./sms.service');

const WEIGHTS = {
  completedJob:      +5,
  cancelledJob:      -3,
  noShow:            -15,
  positiveReview:    +3,
  negativeReview:    -5,
  reportReceived:    -10,
  reportDismissed:   +5,
  verifiedPhone:     +10,
  verifiedId:        +15,
  verifiedFace:      +10,
  latePayment:       -5,
  referralCompleted: +5,
};

function getTrustLevel(score) {
  if (score >= 90) return 'ELITE';
  if (score >= 75) return 'VERIFIED';
  if (score >= 60) return 'TRUSTED';
  if (score >= 40) return 'BASIC';
  if (score < 20)  return 'SUSPENDED';
  return 'NEW';
}

function getTrustBadge(level) {
  const badges = {
    ELITE:     { emoji: '⭐', label: 'Elite Member',  color: 'gold' },
    VERIFIED:  { emoji: '✅', label: 'Verified',       color: 'green' },
    TRUSTED:   { emoji: '🛡️', label: 'Trusted',        color: 'blue' },
    BASIC:     { emoji: '👤', label: 'Basic',           color: 'gray' },
    NEW:       { emoji: '🆕', label: 'New Member',      color: 'gray' },
    SUSPENDED: { emoji: '🚫', label: 'Suspended',       color: 'red' },
  };
  return badges[level] || badges.NEW;
}

async function updateTrustScore(userId, action) {
  const change = WEIGHTS[action] || 0;
  if (change === 0) return;

  let trustScore = await prisma.trustScore.findUnique({ where: { userId } });
  if (!trustScore) {
    trustScore = await prisma.trustScore.create({ data: { userId, score: 50 } });
  }

  const newScore = Math.min(100, Math.max(0, trustScore.score + change));
  const newLevel = getTrustLevel(newScore);

  const updateData = { score: newScore, level: newLevel };
  if (action === 'completedJob')    updateData.completedJobs = { increment: 1 };
  if (action === 'cancelledJob')    updateData.cancelledJobs = { increment: 1 };
  if (action === 'noShow')          updateData.noShowCount   = { increment: 1 };
  if (action === 'reportReceived')  updateData.totalReports  = { increment: 1 };
  if (action === 'reportDismissed') updateData.falseReports  = { increment: 1 };
  if (action === 'verifiedPhone')   updateData.verifiedPhone = true;
  if (action === 'verifiedId')      updateData.verifiedId    = true;
  if (action === 'verifiedFace')    updateData.verifiedFace  = true;

  await prisma.trustScore.update({ where: { userId }, data: updateData });

  console.log(`🛡️ Trust: ${userId} ${trustScore.score} → ${newScore} (${action})`);

  if (newScore < 20 && trustScore.score >= 20) {
    await suspendAccount(userId, 'Trust score fell below minimum threshold');
  }

  if (newLevel !== trustScore.level) {
    await notifyLevelChange(userId, trustScore.level, newLevel);
  }

  return { score: newScore, level: newLevel };
}

async function suspendAccount(userId, reason) {
  await prisma.user.update({ where: { id: userId }, data: { isSuspended: true } });
  await prisma.trustScore.upsert({
    where: { userId },
    create: { userId, score: 0, level: 'SUSPENDED' },
    update: { level: 'SUSPENDED' },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });

  notificationSvc.createNotification({
    userId,
    type: 'SYSTEM',
    title: '🚫 Account Suspended',
    body: `Your account has been suspended. Reason: ${reason}. Contact support@kazishow.co.ke to appeal.`,
  }).catch(console.error);

  if (user?.phone) {
    smsSvc.sendSMS(
      user.phone,
      `KaziShow: Your account has been suspended. Reason: ${reason}. Contact support@kazishow.co.ke to appeal.`
    ).catch(console.error);
  }

  console.log(`🚫 Account suspended: ${userId} — ${reason}`);
}

async function notifyLevelChange(userId, oldLevel, newLevel) {
  const badge = getTrustBadge(newLevel);
  if (['TRUSTED', 'VERIFIED', 'ELITE'].includes(newLevel)) {
    notificationSvc.createNotification({
      userId,
      type: 'SYSTEM',
      title: `${badge.emoji} Trust Level Up!`,
      body: `Congratulations! You are now a ${badge.label} member on KaziShow!`,
    }).catch(console.error);
  }
}

async function detectFraud(userId) {
  const alerts = [];
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentCancellations = await prisma.booking.count({
    where: { customerId: userId, status: 'CANCELLED', createdAt: { gte: since7d } },
  });
  if (recentCancellations >= 5) {
    alerts.push({
      type: 'REPEATED_CANCELLATIONS',
      severity: 'MEDIUM',
      description: `User cancelled ${recentCancellations} bookings in the last 7 days`,
    });
  }

  const recentReviews = await prisma.review.count({
    where: { customerId: userId, createdAt: { gte: since24h } },
  });
  if (recentReviews >= 5) {
    alerts.push({
      type: 'FAKE_REVIEWS',
      severity: 'HIGH',
      description: `User posted ${recentReviews} reviews in 24 hours`,
    });
  }

  const failedPayments = await prisma.payment.count({
    where: { booking: { customerId: userId }, status: 'FAILED', createdAt: { gte: since24h } },
  });
  if (failedPayments >= 3) {
    alerts.push({
      type: 'PAYMENT_MANIPULATION',
      severity: 'HIGH',
      description: `User had ${failedPayments} failed payments in 24 hours`,
    });
  }

  for (const alert of alerts) {
    await prisma.fraudAlert.create({
      data: { userId, type: alert.type, description: alert.description, severity: alert.severity },
    });
    console.log(`🚨 Fraud alert: ${alert.type} for user ${userId}`);
    if (alert.severity === 'CRITICAL') {
      await suspendAccount(userId, alert.description);
    }
  }

  return alerts;
}

module.exports = { updateTrustScore, getTrustLevel, getTrustBadge, suspendAccount, detectFraud };
