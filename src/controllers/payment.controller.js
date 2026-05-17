const prisma = require('../config/db');
const mpesaSvc = require('../services/mpesa.service');
const notificationSvc = require('../services/notification.service');

async function stkPush(req, res) {
  try {
    const { bookingId, phone } = req.body;
    if (!bookingId || !phone) {
      return res.status(400).json({ success: false, message: 'bookingId and phone are required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (booking.paymentStatus === 'PAID') {
      return res.status(400).json({ success: false, message: 'Booking is already paid' });
    }

    // Create or find existing payment record
    let payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) {
      payment = await prisma.payment.create({
        data: { bookingId, amount: booking.totalAmount, phone, status: 'PENDING' },
      });
    }

    const result = await mpesaSvc.stkPush({
      phone,
      amount: booking.totalAmount,
      bookingId,
      accountRef: `KaziShow-${bookingId.slice(-6).toUpperCase()}`,
      description: `KaziShow: ${booking.service?.name || 'Service'} booking`,
    });

    // Save the CheckoutRequestID so we can query status later
    await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutRequestId: result.CheckoutRequestID },
    });

    console.log(`💳 STK Push sent for booking ${bookingId} — KSh ${booking.totalAmount}`);

    res.json({
      success: true,
      data: {
        message: 'M-Pesa payment prompt sent to your phone',
        checkoutRequestId: result.CheckoutRequestID,
        merchantRequestId: result.MerchantRequestID,
      },
    });
  } catch (err) {
    console.error('❌ stkPush error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function mpesaCallback(req, res) {
  try {
    // Acknowledge Daraja immediately — required within 5 seconds
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    const body = req.body?.Body?.stkCallback;
    if (!body) return;

    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = body;

    const payment = await prisma.payment.findFirst({
      where: { checkoutRequestId: CheckoutRequestID },
      include: { booking: { include: { customer: true } } },
    });
    if (!payment) {
      console.error('❌ M-Pesa callback: no payment found for', CheckoutRequestID);
      return;
    }

    if (ResultCode !== 0) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', type: 'CALLBACK' },
      });
      console.log(`❌ M-Pesa payment failed: ${ResultDesc}`);
      return;
    }

    // Extract metadata from Daraja response
    const meta = {};
    (CallbackMetadata?.Item || []).forEach((item) => {
      meta[item.Name] = item.Value;
    });

    const mpesaRef = meta.MpesaReceiptNumber || null;
    const amount = meta.Amount || payment.amount;

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS', type: 'CALLBACK', mpesaRef },
      });
      const updatedBk = await tx.booking.update({
        where: { id: payment.bookingId },
        data: { paymentStatus: 'PAID', mpesaRef },
        include: { provider: true },
      });
      // Credit provider wallet
      await tx.provider.update({
        where: { id: updatedBk.providerId },
        data: {
          walletBalance: { increment: amount },
          totalEarned:   { increment: amount },
        },
      });
    });

    console.log(`✅ M-Pesa payment confirmed! Booking ${payment.bookingId} — Ref: ${mpesaRef}`);

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: payment.bookingId },
      include: { provider: { include: { user: true } } },
    });

    notificationSvc.notifyPaymentReceived({
      booking: updatedBooking,
      customerUser: payment.booking.customer,
      providerUserId: updatedBooking.provider.user.id,
      providerDeviceToken: updatedBooking.provider.user.deviceToken,
      amount,
      mpesaRef,
    }).catch(console.error);
  } catch (err) {
    console.error('❌ mpesaCallback error:', err.message);
  }
}

async function getPaymentStatus(req, res) {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const payment = await prisma.payment.findUnique({ where: { bookingId } });

    res.json({
      success: true,
      data: {
        bookingId,
        paymentStatus: booking.paymentStatus,
        payment: payment || null,
      },
    });
  } catch (err) {
    console.error('❌ getPaymentStatus error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyPayments(req, res) {
  try {
    const payments = await prisma.payment.findMany({
      where: { booking: { customerId: req.user.id } },
      include: {
        booking: {
          include: {
            provider: { select: { businessName: true, category: true } },
            service: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const successPayments = payments.filter((p) => p.status === 'SUCCESS');
    const monthTotal = successPayments
      .filter((p) => new Date(p.createdAt) >= startOfMonth)
      .reduce((sum, p) => sum + p.amount, 0);
    const allTotal = successPayments.reduce((sum, p) => sum + p.amount, 0);

    res.json({ success: true, data: { payments, monthTotal, allTotal } });
  } catch (err) {
    console.error('❌ getMyPayments error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function checkPaymentStatus(req, res) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      select: { id: true, paymentStatus: true, status: true, customerId: true },
    });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    res.json({
      success: true,
      data: { id: booking.id, paymentStatus: booking.paymentStatus, status: booking.status },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { stkPush, mpesaCallback, getPaymentStatus, getMyPayments, checkPaymentStatus };
