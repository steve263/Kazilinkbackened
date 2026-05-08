const prisma = require('../config/db');

async function getMyReferralCode(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { referralCode: true, name: true, totalRewards: true },
    });

    const referralLink = `${process.env.FRONTEND_URL || 'https://kazishow.vercel.app'}/ref/${user.referralCode}`;

    res.json({
      success: true,
      data: {
        code: user.referralCode,
        link: referralLink,
        totalRewards: user.totalRewards,
        shareMessage: `Join KaziShow and get KSh 100 off your first booking! Use my referral link: ${referralLink}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyReferrals(req, res) {
  try {
    const referrals = await prisma.referral.findMany({
      where: { referrerId: req.user.id },
      include: { referred: { select: { name: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      total: referrals.length,
      registered: referrals.filter((r) => r.status === 'REGISTERED').length,
      completed: referrals.filter((r) => r.status === 'REWARDED').length,
      totalEarned: referrals.filter((r) => r.rewardPaid).reduce((sum, r) => sum + r.rewardAmount, 0),
    };

    res.json({ success: true, data: { referrals, stats } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyRewards(req, res) {
  try {
    const rewards = await prisma.reward.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });

    const activeRewards = rewards.filter((r) => r.status === 'ACTIVE');
    const totalActive = activeRewards.reduce((sum, r) => sum + r.amount, 0);

    res.json({
      success: true,
      data: {
        rewards,
        activeRewards,
        totalActive,
        totalEarned: rewards.reduce((sum, r) => sum + r.amount, 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function validateCode(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { referralCode: req.params.code },
      select: { name: true, referralCode: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Invalid referral code' });
    }

    res.json({
      success: true,
      data: {
        referrerName: user.name,
        discount: 100,
        message: `${user.name} invited you! Register to get KSh 100 off your first booking.`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getReferralStats(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { totalRewards: true, referralCode: true },
    });

    const referrals = await prisma.referral.findMany({ where: { referrerId: req.user.id } });
    const frontendUrl = process.env.FRONTEND_URL || 'https://kazishow.vercel.app';

    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralLink: `${frontendUrl}/ref/${user.referralCode}`,
        totalReferrals: referrals.length,
        pendingReferrals: referrals.filter((r) => r.status === 'REGISTERED').length,
        completedReferrals: referrals.filter((r) => r.status === 'REWARDED').length,
        totalEarned: user.totalRewards,
        nextReward: 200,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function useReward(req, res) {
  try {
    const { rewardId, bookingId } = req.body;

    const reward = await prisma.reward.findUnique({ where: { id: rewardId } });

    if (!reward || reward.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Reward not found' });
    }
    if (reward.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'This reward has already been used or expired' });
    }
    if (reward.expiresAt && reward.expiresAt < new Date()) {
      await prisma.reward.update({ where: { id: rewardId }, data: { status: 'EXPIRED' } });
      return res.status(400).json({ success: false, message: 'This reward has expired' });
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { totalAmount: { decrement: reward.amount } },
    });

    await prisma.reward.update({
      where: { id: rewardId },
      data: { status: 'USED', usedAt: new Date() },
    });

    res.json({
      success: true,
      data: {
        discountApplied: reward.amount,
        message: `KSh ${reward.amount} discount applied to your booking!`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getMyReferralCode, getMyReferrals, getMyRewards, validateCode, getReferralStats, useReward };
