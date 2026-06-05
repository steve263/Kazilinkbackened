const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const emailSvc = require('../services/email.service');

// In-memory OTP store keyed by phone OR email
const otpStore = new Map();

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(raw) {
  let p = raw.replace(/\s+/g, '');
  if (p.startsWith('0')) p = '+254' + p.slice(1);
  else if (p.startsWith('254') && !p.startsWith('+')) p = '+' + p;
  return p;
}

function isEmail(val) {
  return val.includes('@');
}

async function forgotPassword(req, res) {
  try {
    const { phone, email } = req.body;
    const raw = (email || phone || '').trim();
    if (!raw) return res.status(400).json({ success: false, message: 'phone or email is required' });

    let user;
    if (isEmail(raw)) {
      user = await prisma.user.findFirst({ where: { email: raw.toLowerCase() } });
    } else {
      user = await prisma.user.findUnique({ where: { phone: normalizePhone(raw) } });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with that phone or email' });
    }

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    const record = { otp, expiresAt: expiry, verified: false, userId: user.id };

    // Store by both phone and email so either can be used in verify step
    otpStore.set(normalizePhone(user.phone), record);
    if (user.email) otpStore.set(user.email.toLowerCase(), record);

    if (!user.email) {
      return res.status(400).json({ success: false, message: 'No email address on this account. Contact support.' });
    }

    // Fire email — don't await so the response is instant; errors appear in Railway logs
    emailSvc.sendEmail({
      to: user.email,
      subject: 'KaziShow — Your Password Reset Code',
      html: emailSvc.tplOTPEmail({ name: user.name, otp }),
    }).then(() => {
      console.log(`✅ Forgot-password OTP emailed to ${user.email}`);
    }).catch((err) => {
      console.error(`❌ Forgot-password OTP email FAILED for ${user.email}:`, err.message);
    });

    res.json({
      success: true,
      data: {
        message: `Code sent to ${user.email.replace(/(.{2}).*(@.*)/, '$1***$2')}`,
        sentVia: ['email'],
      },
    });
  } catch (err) {
    console.error('❌ forgotPassword error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function verifyOTP(req, res) {
  try {
    const { phone, email, otp } = req.body;
    const raw = (email || phone || '').trim();
    if (!raw || !otp) return res.status(400).json({ success: false, message: 'identifier and otp are required' });

    const key = isEmail(raw) ? raw.toLowerCase() : normalizePhone(raw);
    const record = otpStore.get(key);

    if (!record) return res.status(400).json({ success: false, message: 'No OTP requested. Please request a new code.' });
    if (new Date() > record.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    if (record.otp !== String(otp)) return res.status(400).json({ success: false, message: 'Incorrect code. Please try again.' });

    record.verified = true;
    res.json({ success: true, data: { message: 'OTP verified successfully' } });
  } catch (err) {
    console.error('❌ verifyOTP error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resetPassword(req, res) {
  try {
    const { phone, email, password } = req.body;
    const raw = (email || phone || '').trim();
    if (!raw || !password) return res.status(400).json({ success: false, message: 'identifier and password are required' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const key = isEmail(raw) ? raw.toLowerCase() : normalizePhone(raw);
    const record = otpStore.get(key);

    if (!record || !record.verified) {
      return res.status(400).json({ success: false, message: 'Please verify your OTP first' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: record.userId }, data: { password: hashed } });

    otpStore.delete(key);
    console.log(`🔑 Password reset for user ${record.userId}`);
    res.json({ success: true, data: { message: 'Password reset successfully. You can now log in.' } });
  } catch (err) {
    console.error('❌ resetPassword error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { forgotPassword, verifyOTP, resetPassword };
