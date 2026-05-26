const prisma = require('../config/db');
const trustSvc = require('../services/trust.service');
const notificationSvc = require('../services/notification.service');
const smsSvc = require('../services/sms.service');
const firebaseSvc = require('../services/firebase.service');

async function submitReport(req, res) {
  try {
    console.log('📋 Report submission received:', req.body);
    console.log('📋 Reporter:', req.user.id, req.user.name);

    const { reportedId, type, description, evidence, bookingId } = req.body;
    console.log('📋 Report data:', { reportedId, type, description });

    if (!reportedId || !type || !description) {
      console.log('❌ Missing required fields');
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

    console.log('✅ Report saved to database:', report.id);

    // Fire-and-forget — don't let these block or fail the response
    trustSvc.updateTrustScore(reportedId, 'reportReceived').catch(console.error);

    prisma.user.findMany({ where: { role: 'ADMIN' } }).then((admins) => {
      for (const admin of admins) {
        notificationSvc.createNotification({
          userId: admin.id,
          type: 'SYSTEM',
          title: '🚨 New Report Submitted',
          body: `New ${type} report against ${reportedId}. Please review in admin dashboard.`,
        }).catch(console.error);
      }
    }).catch(console.error);

    prisma.report.count({ where: { reportedId, status: 'PENDING' } }).then((totalPending) => {
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
    }).catch(console.error);

    res.json({
      success: true,
      data: { report, message: 'Report submitted successfully. Our team will review it within 24 hours.' },
    });
  } catch (err) {
    console.error('❌ submitReport error:', err.message);
    console.error('❌ Full error:', err);
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
    console.log('📋 Admin fetching reports...');
    console.log('📋 Admin user:', req.user.id, req.user.role);

    const { status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    console.log('📋 Query filters:', where);

    const reports = await prisma.report.findMany({
      where,
      include: {
        reporter: { select: { id: true, name: true, phone: true, role: true } },
        reported: { select: { id: true, name: true, phone: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`✅ Found ${reports.length} reports`);
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('❌ getAllReports error:', err.message);
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

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Suspension reason is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, phone: true, deviceToken: true, role: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isSuspended: true },
    });

    await prisma.trustScore.upsert({
      where: { userId: req.params.id },
      create: { userId: req.params.id, score: 0, level: 'SUSPENDED' },
      update: { score: 0, level: 'SUSPENDED' },
    });

    console.log(`🚫 Account suspended: ${user.name} — Reason: ${reason}`);

    // Push notification (reaches user even when app is closed)
    firebaseSvc.sendPushNotification({
      deviceToken: user.deviceToken,
      title: '🚫 Account Suspended',
      body: `Your KaziShow account has been suspended. Reason: ${reason}. Tap to appeal.`,
      data: { url: '/appeal', type: 'ACCOUNT_SUSPENDED' },
    }).catch(console.error);

    // In-app notification
    notificationSvc.createNotification({
      userId: req.params.id,
      type: 'SYSTEM',
      title: '🚫 Account Suspended',
      body: `Your account has been suspended. Reason: ${reason}. You can appeal this decision by tapping "Appeal Suspension".`,
    }).catch(console.error);

    // SMS (most reliable — always reaches them)
    smsSvc.sendSMS(
      user.phone,
      `KaziShow: Your account has been suspended. Reason: ${reason}. To appeal, open the KaziShow app and tap "Appeal Suspension". For help contact: 0795542312.`
    ).catch(console.error);

    console.log(`✅ Suspension notifications sent to ${user.name}`);

    res.json({
      success: true,
      data: {
        message: `Account suspended. ${user.name} has been notified via SMS and push notification.`,
      },
    });
  } catch (err) {
    console.error('❌ suspendUser error:', err.message);
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

// ─── Suspension Appeal ────────────────────────────────────────────────────────

async function submitAppeal(req, res) {
  try {
    const { appealReason, explanation, evidence, contactPhone, contactEmail } = req.body;

    if (!appealReason || !explanation || !contactPhone) {
      return res.status(400).json({ success: false, message: 'appealReason, explanation and contactPhone are required' });
    }
    if (explanation.length < 50) {
      return res.status(400).json({ success: false, message: 'Explanation must be at least 50 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.isSuspended) {
      return res.status(400).json({ success: false, message: 'Your account is not suspended' });
    }

    // Check for existing active appeal
    const existing = await prisma.suspensionAppeal.findFirst({
      where: { userId: req.user.id, status: { in: ['PENDING', 'UNDER_REVIEW', 'MORE_INFO_NEEDED'] } },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending appeal. Please wait for our response.',
        data: { appealId: existing.id, status: existing.status },
      });
    }

    // Check 30-day wait after rejection
    const recentRejection = await prisma.suspensionAppeal.findFirst({
      where: { userId: req.user.id, status: 'REJECTED', resolvedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      orderBy: { resolvedAt: 'desc' },
    });
    if (recentRejection) {
      const daysLeft = Math.ceil(
        (new Date(recentRejection.resolvedAt).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)
      );
      return res.status(400).json({
        success: false,
        message: `Your previous appeal was rejected. You can submit a new appeal in ${daysLeft} day(s).`,
      });
    }

    const trustScore = await prisma.trustScore.findUnique({ where: { userId: req.user.id } });

    const appeal = await prisma.suspensionAppeal.create({
      data: {
        userId: req.user.id,
        suspensionReason: trustScore?.level || 'Account suspended by admin',
        appealReason,
        explanation,
        evidence: evidence || [],
        contactPhone,
        contactEmail: contactEmail || null,
      },
    });

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '⚖️ New Suspension Appeal',
        body: `${user.name} has submitted a suspension appeal. Please review in the admin dashboard.`,
      }).catch(console.error);
    }

    smsSvc.sendSMS(
      user.phone,
      `KaziShow: Your suspension appeal has been received. Our team will review within 48 hours. Appeal ID: ${appeal.id.slice(0, 8).toUpperCase()}`
    ).catch(console.error);

    console.log(`⚖️ Appeal submitted by ${user.name} — ${appealReason}`);
    res.status(201).json({
      success: true,
      data: {
        appeal,
        message: 'Your appeal has been submitted. We will review it within 48 hours.',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyAppeal(req, res) {
  try {
    const appeal = await prisma.suspensionAppeal.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: appeal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllAppeals(req, res) {
  try {
    console.log('⚖️ Admin fetching appeals...');

    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const appeals = await prisma.suspensionAppeal.findMany({
      where,
      include: {
        user: {
          select: {
            id: true, name: true, phone: true, role: true, createdAt: true,
            provider: {
              select: { businessName: true, category: true, rating: true, totalReviews: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`✅ Found ${appeals.length} appeals`);
    res.json({ success: true, data: appeals });
  } catch (err) {
    console.error('❌ getAllAppeals error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approveAppeal(req, res) {
  try {
    const { adminNote } = req.body;

    const appeal = await prisma.suspensionAppeal.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', adminNote: adminNote || null, reviewedBy: req.user.id, resolvedAt: new Date() },
      include: { user: true },
    });

    await prisma.user.update({ where: { id: appeal.userId }, data: { isSuspended: false } });
    await prisma.trustScore.upsert({
      where: { userId: appeal.userId },
      create: { userId: appeal.userId, score: 40, level: 'BASIC' },
      update: { score: 40, level: 'BASIC' },
    });

    firebaseSvc.sendPushNotification({
      deviceToken: appeal.user.deviceToken,
      title: '✅ Appeal Approved!',
      body: 'Your account has been reinstated. Welcome back to KaziShow!',
      data: { url: '/' },
    }).catch(console.error);

    notificationSvc.createNotification({
      userId: appeal.userId,
      type: 'SYSTEM',
      title: '✅ Appeal Approved!',
      body: `Your suspension appeal has been approved. ${adminNote ? 'Note: ' + adminNote + '. ' : ''}Welcome back to KaziShow!`,
    }).catch(console.error);

    smsSvc.sendSMS(
      appeal.user.phone,
      `KaziShow: Great news! Your suspension appeal has been APPROVED. Your account is reinstated. Welcome back!`
    ).catch(console.error);

    console.log(`✅ Appeal approved for ${appeal.user.name}`);
    res.json({ success: true, data: appeal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectAppeal(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const appeal = await prisma.suspensionAppeal.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', adminNote: reason, reviewedBy: req.user.id, resolvedAt: new Date() },
      include: { user: true },
    });

    firebaseSvc.sendPushNotification({
      deviceToken: appeal.user.deviceToken,
      title: '❌ Appeal Decision',
      body: `Your suspension appeal was not approved. Reason: ${reason}`,
      data: { url: '/' },
    }).catch(console.error);

    notificationSvc.createNotification({
      userId: appeal.userId,
      type: 'SYSTEM',
      title: '❌ Appeal Not Approved',
      body: `Your appeal was reviewed but not approved. Reason: ${reason}. Contact support for further assistance.`,
    }).catch(console.error);

    smsSvc.sendSMS(
      appeal.user.phone,
      `KaziShow: Your suspension appeal was not approved. Reason: ${reason}. Contact support: 0795542312 or support@kazishow.co.ke`
    ).catch(console.error);

    console.log(`❌ Appeal rejected for ${appeal.user.name} — ${reason}`);
    res.json({ success: true, data: appeal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function requestMoreInfo(req, res) {
  try {
    const { questions } = req.body;
    if (!questions) {
      return res.status(400).json({ success: false, message: 'questions field is required' });
    }

    const appeal = await prisma.suspensionAppeal.update({
      where: { id: req.params.id },
      data: { status: 'MORE_INFO_NEEDED', adminNote: questions, reviewedBy: req.user.id },
      include: { user: true },
    });

    firebaseSvc.sendPushNotification({
      deviceToken: appeal.user.deviceToken,
      title: '📋 More Information Needed',
      body: 'Admin needs more information about your appeal. Please open the app.',
      data: { url: '/appeal/provide-info' },
    }).catch(console.error);

    notificationSvc.createNotification({
      userId: appeal.userId,
      type: 'SYSTEM',
      title: '📋 More Information Needed',
      body: `Admin has questions about your appeal: ${questions}. Please provide more details in the app.`,
    }).catch(console.error);

    smsSvc.sendSMS(
      appeal.user.phone,
      `KaziShow: Your suspension appeal needs more information. Please open the KaziShow app to provide details.`
    ).catch(console.error);

    res.json({ success: true, data: appeal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function provideMoreInfo(req, res) {
  try {
    const { additionalInfo, newEvidence } = req.body;
    if (!additionalInfo) {
      return res.status(400).json({ success: false, message: 'additionalInfo is required' });
    }

    const appeal = await prisma.suspensionAppeal.findUnique({ where: { id: req.params.id } });
    if (!appeal || appeal.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (appeal.status !== 'MORE_INFO_NEEDED') {
      return res.status(400).json({ success: false, message: 'Appeal is not awaiting more information' });
    }

    const updated = await prisma.suspensionAppeal.update({
      where: { id: req.params.id },
      data: {
        explanation: appeal.explanation + '\n\n--- Additional Information ---\n' + additionalInfo,
        evidence: [...appeal.evidence, ...(newEvidence || [])],
        status: 'UNDER_REVIEW',
        updatedAt: new Date(),
      },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      notificationSvc.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: '📋 Appeal Updated',
        body: `${req.user.name} provided additional information for their suspension appeal.`,
      }).catch(console.error);
    }

    res.json({ success: true, data: updated });
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
  submitAppeal,
  getMyAppeal,
  getAllAppeals,
  approveAppeal,
  rejectAppeal,
  requestMoreInfo,
  provideMoreInfo,
};
