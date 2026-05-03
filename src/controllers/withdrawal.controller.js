const prisma = require('../config/db');
const mpesaSvc = require('../services/mpesa.service');

const MIN_WITHDRAWAL = 100;

async function requestWithdrawal(req, res) {
  try {
    const { amount, phone } = req.body;
    if (!amount || !phone) {
      return res.status(400).json({ success: false, message: 'amount and phone are required' });
    }
    const parsed = Math.floor(Number(amount));
    if (parsed < MIN_WITHDRAWAL) {
      return res.status(400).json({ success: false, message: `Minimum withdrawal is KSh ${MIN_WITHDRAWAL}` });
    }

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    if (provider.walletBalance < parsed) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: KSh ${provider.walletBalance.toLocaleString()}`,
      });
    }

    // Check no pending withdrawal already
    const pending = await prisma.withdrawal.findFirst({
      where: { providerId: provider.id, status: 'PENDING' },
    });
    if (pending) {
      return res.status(400).json({ success: false, message: 'You already have a pending withdrawal request' });
    }

    // Deduct from wallet and create withdrawal record atomically
    const [withdrawal] = await prisma.$transaction([
      prisma.withdrawal.create({
        data: { providerId: provider.id, amount: parsed, phone },
      }),
      prisma.provider.update({
        where: { id: provider.id },
        data: { walletBalance: { decrement: parsed } },
      }),
    ]);

    console.log(`💰 Withdrawal requested: ${provider.businessName} — KSh ${parsed} to ${phone}`);
    res.status(201).json({ success: true, data: { withdrawal } });
  } catch (err) {
    console.error('❌ requestWithdrawal error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyWithdrawals(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const withdrawals = await prisma.withdrawal.findMany({
      where: { providerId: provider.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: { withdrawals, walletBalance: provider.walletBalance } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Admin: list all pending withdrawals
async function getAdminWithdrawals(req, res) {
  try {
    const { status = 'PENDING' } = req.query;
    const withdrawals = await prisma.withdrawal.findMany({
      where: status !== 'ALL' ? { status } : undefined,
      include: {
        provider: {
          select: {
            businessName: true,
            category: true,
            walletBalance: true,
            user: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { withdrawals } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Admin: process (trigger B2C) or manually mark complete/failed
async function processWithdrawal(req, res) {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'approve' | 'reject'

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id },
      include: { provider: { include: { user: true } } },
    });
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Withdrawal is not pending' });
    }

    if (action === 'reject') {
      await prisma.$transaction([
        prisma.withdrawal.update({ where: { id }, data: { status: 'FAILED', failReason: 'Rejected by admin' } }),
        // Refund wallet
        prisma.provider.update({
          where: { id: withdrawal.providerId },
          data: { walletBalance: { increment: withdrawal.amount } },
        }),
      ]);
      return res.json({ success: true, data: { message: 'Withdrawal rejected and refunded' } });
    }

    // Mark as PROCESSING and trigger B2C
    await prisma.withdrawal.update({ where: { id }, data: { status: 'PROCESSING' } });

    try {
      const b2cResult = await mpesaSvc.b2c({
        phone: withdrawal.phone,
        amount: withdrawal.amount,
        withdrawalId: withdrawal.id,
        remarks: `KaziShow payout to ${withdrawal.provider.businessName}`,
      });

      await prisma.withdrawal.update({
        where: { id },
        data: { status: 'COMPLETED', mpesaRef: b2cResult.OriginatorConversationID || null },
      });

      console.log(`✅ B2C payout sent: ${withdrawal.provider.businessName} — KSh ${withdrawal.amount}`);
      res.json({ success: true, data: { message: 'Payout sent via M-Pesa', result: b2cResult } });
    } catch (b2cErr) {
      // B2C failed — refund wallet
      await prisma.$transaction([
        prisma.withdrawal.update({ where: { id }, data: { status: 'FAILED', failReason: b2cErr.message } }),
        prisma.provider.update({
          where: { id: withdrawal.providerId },
          data: { walletBalance: { increment: withdrawal.amount } },
        }),
      ]);
      console.error('❌ B2C failed:', b2cErr.message);
      res.status(502).json({ success: false, message: `B2C payout failed: ${b2cErr.message}` });
    }
  } catch (err) {
    console.error('❌ processWithdrawal error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { requestWithdrawal, getMyWithdrawals, getAdminWithdrawals, processWithdrawal };
