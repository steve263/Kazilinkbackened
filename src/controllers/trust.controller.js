const prisma = require('../config/db');
const trustSvc = require('../services/trust.service');
const notificationSvc = require('../services/notification.service');
const smsSvc = require('../services/sms.service');

async function submitReport(req, res) {
  try {
    const { reportedId, type, description, evidence, bookingId } = req.body;

    if (!reportedId || !type || !description) {
      return res.status(400).json({ success: false, message: 'reportedId, type and description are required' });
    }
    if (reportedId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot report yourself' });
    }

    const existing = await prisma.report.findFirst({
      where: { reporterId: req.user.id, reportedId, type, status: 'PENDING' },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already submitted this report' });
    }

    const report = await prisma.report.create({
      data: { reporterId: req.user.id, reportedId, type, description, evidence: evidence || null, bookingId: bookingId || null },
    });

    await trustSvc.updateTrustScore(reportedId, 'reportReceived');

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '🚨 New Report Submitted',
        body: `New ${type} report submitted. Please review in admin dashboard.`,
      }).catch(console.error);
    }

    const totalPending = await prisma.report.count({ where: { reportedId, status: 'PENDING' } });
    if (totalPending >= 5) {
      prisma.fraudAlert.create({
        data: {
          userId: reportedId,
          type: 'UNUSUAL_ACTIVITY',
          description: `User has ${totalPending} pending reports`,
          severity: 'HIGH',
        },
      }).catch(console.error);
    }

    console.log(`🚨 Report: ${type} against ${reportedId} by ${req.user.id}`);
    res.json({
      success: true,
      data: { report, message: 'Report submitted. Our team will review within 24 hours.' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

function getTrustTips(trustScore) {
  const tips = [];
  if (!trustScore.verifiedPhone) tips.push('Verify your phone number (+10 pts)');
  if (!trustScore.verifiedId)    tips.push('Upload your National ID (+15 pts)');
  if (!trustScore.verifiedFace)  tips.push('Complete face verification (+10 pts)');
  if (trustScore.cancelledJobs > 2) tips.push('Avoid cancellations to keep your score high');
  if (trustScore.noShowCount > 0)   tips.push('Always show up for bookings to rebuild trust');
  return tips;
}

async function getMyTrustScore(req, res) {
  try {
    let trustScore = await prisma.trustScore.findUnique({ where: { userId: req.user.id } });
    if (!trustScore) {
      trustScore = await prisma.trustScore.create({ data: { userId: req.user.id, score: 50 } });
    }
    res.json({
      success: true,
      data: { ...trustScore, badge: trustSvc.getTrustBadge(trustScore.level), tips: getTrustTips(trustScore) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getUserTrustScore(req, res) {
  try {
    const trustScore = await prisma.trustScore.findUnique({
      where: { userId: req.params.userId },
      select: { score: true, level: true, completedJobs: true, verifiedPhone: true, verifiedId: true, verifiedFace: true },
    });
    if (!trustScore) {
      return res.json({ success: true, data: { score: 50, level: 'NEW', badge: trustSvc.getTrustBadge('NEW') } });
    }
    res.json({ success: true, data: { ...trustScore, badge: trustSvc.getTrustBadge(trustScore.level) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyReports(req, res) {
  try {
    const reports = await prisma.report.findMany({
      where: { reporterId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllReports(req, res) {
  try {
    const { status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const reports = await prisma.report.findMany({
      where,
      include: {
        reporter: { select: { name: true, phone: true } },
        reported: { select: { name: true, phone: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resolveReport(req, res) {
  try {
    const { adminNote, action } = req.body;
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status: 'RESOLVED', adminNote, resolvedAt: new Date() },
      include: { reporter: true, reported: true },
    });

    if (action === 'SUSPEND') {
      await trustSvc.suspendAccount(report.reportedId, `Report resolved: ${report.type}`);
    }

    notificationSvc.createNotification({
      userId: report.reporterId,
      type: 'SYSTEM',
      title: '✅ Report Resolved',
      body: 'Your report has been reviewed and resolved. Thank you for keeping KaziShow safe!',
    }).catch(console.error);

    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function dismissReport(req, res) {
  try {
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
      include: { reported: true },
    });
    await trustSvc.updateTrustScore(report.reportedId, 'reportDismissed');
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getFraudAlerts(req, res) {
  try {
    const alerts = await prisma.fraudAlert.findMany({
      where: { resolved: false },
      include: { user: { select: { name: true, phone: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resolveFraudAlert(req, res) {
  try {
    await prisma.fraudAlert.update({ where: { id: req.params.id }, data: { resolved: true } });
    res.json({ success: true, data: { message: 'Fraud alert resolved' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function suspendUser(req, res) {
  try {
    const { reason } = req.body;
    await trustSvc.suspendAccount(req.params.id, reason || 'Admin action');
    res.json({ success: true, data: { message: 'User suspended successfully' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function unsuspendUser(req, res) {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isSuspended: false } });
    await prisma.trustScore.upsert({
      where: { userId: req.params.id },
      create: { userId: req.params.id, score: 40, level: 'BASIC' },
      update: { level: 'BASIC', score: 40 },
    });

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });

    notificationSvc.createNotification({
      userId: req.params.id,
      type: 'SYSTEM',
      title: '✅ Account Reinstated',
      body: 'Your account has been reinstated. Welcome back to KaziShow!',
    }).catch(console.error);

    if (user?.phone) {
      smsSvc.sendSMS(user.phone, 'KaziShow: Your account has been reinstated. Welcome back!').catch(console.error);
    }

    res.json({ success: true, data: { message: 'User unsuspended successfully' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTrustStats(req, res) {
  try {
    const [pendingReports, fraudAlerts, suspendedUsers, resolvedToday] = await Promise.all([
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.fraudAlert.count({ where: { resolved: false } }),
      prisma.user.count({ where: { isSuspended: true } }),
      prisma.report.count({
        where: {
          status: { in: ['RESOLVED', 'DISMISSED'] },
          resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);
    res.json({ success: true, data: { pendingReports, fraudAlerts, suspendedUsers, resolvedToday } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  submitReport,
  getMyTrustScore,
  getUserTrustScore,
  getMyReports,
  getAllReports,
  resolveReport,
  dismissReport,
  getFraudAlerts,
  resolveFraudAlert,
  suspendUser,
  unsuspendUser,
  getTrustStats,
};
