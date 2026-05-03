const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const smsSvc = require('../services/sms.service');

// In-memory OTP store: phone -> { otp, expiresAt, verified }
const otpStore = new Map();

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function forgotPassword(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'phone is required' });

    const normalPhone = phone.replace(/\s/g, '');
    const user = await prisma.user.findUnique({ where: { phone: normalPhone } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with that phone number' });
    }

    const otp = generateOTP();
    otpStore.set(normalPhone, { otp, expiresAt: new Date(Date.now() + 5 * 60 * 1000), verified: false });

    await smsSvc.sendSMS(normalPhone, `KaziShow: Your password reset code is ${otp}. Expires in 5 minutes. Do not share this code.`);

    console.log(`🔑 Password reset OTP sent to ${normalPhone}`);
    res.json({ success: true, data: { message: 'OTP sent to your phone number' } });
  } catch (err) {
    console.error('❌ forgotPassword error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function verifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'phone and otp are required' });

    const normalPhone = phone.replace(/\s/g, '');
    const record = otpStore.get(normalPhone);

    if (!record) return res.status(400).json({ success: false, message: 'No OTP requested for this number. Please request a new code.' });
    if (new Date() > record.expiresAt) {
      otpStore.delete(normalPhone);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    if (record.otp !== String(otp)) return res.status(400).json({ success: false, message: 'Incorrect code. Please try again.' });

    otpStore.set(normalPhone, { ...record, verified: true });
    res.json({ success: true, data: { message: 'OTP verified successfully' } });
  } catch (err) {
    console.error('❌ verifyOTP error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resetPassword(req, res) {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ success: false, message: 'phone and password are required' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const normalPhone = phone.replace(/\s/g, '');
    const record = otpStore.get(normalPhone);

    if (!record || !record.verified) {
      return res.status(400).json({ success: false, message: 'Please verify your OTP first' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { phone: normalPhone }, data: { password: hashed } });

    otpStore.delete(normalPhone);
    console.log(`🔑 Password reset for ${normalPhone}`);
    res.json({ success: true, data: { message: 'Password reset successfully. You can now log in.' } });
  } catch (err) {
    console.error('❌ resetPassword error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { forgotPassword, verifyOTP, resetPassword };
