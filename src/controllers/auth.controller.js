const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function sanitize(user) {
  const { password, ...safe } = user;
  return safe;
}

function generateReferralCode(name) {
  const namePart = name.replace(/\s+/g, '').toUpperCase().slice(0, 5);
  const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${namePart}${randPart}`;
}

async function register(req, res) {
  try {
    const {
      phone, password, name, email, role = 'CUSTOMER', category, businessName, location,
      profilePhoto, idPhotoUrl, idBackPhotoUrl, portfolioPhotos, coverImage, profileImage,
      description, workingHoursStart, workingHoursEnd, services,
      skills, yearsExperience, education, certificates, portfolioVideoUrl, portfolioVideoPublicId,
      referralCode: incomingReferralCode,
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ success: false, message: 'phone and name are required' });
    }

    // If no password provided, default to last 6 digits of phone
    const normalPhone = normalizePhone(phone);
    let resolvedPassword = (password || '').trim();
    let usedDefaultPassword = false;
    if (!resolvedPassword || resolvedPassword.length < 6) {
      resolvedPassword = normalPhone.slice(-6);
      usedDefaultPassword = true;
    }

    const normalRole = role.toUpperCase();
    if (!['CUSTOMER', 'PROVIDER', 'ADMIN'].includes(normalRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    if (normalRole === 'PROVIDER' && (!category || !businessName)) {
      return res.status(400).json({ success: false, message: 'category and businessName are required for providers' });
    }

    const existing = await prisma.user.findUnique({ where: { phone: normalPhone } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Phone number already registered' });
    }

    const normalEmail = email?.trim().toLowerCase() || null;
    if (normalEmail) {
      const emailTaken = await prisma.user.findUnique({ where: { email: normalEmail } });
      if (emailTaken) {
        return res.status(409).json({ success: false, message: 'Email address already registered' });
      }
    }

    const hashed = await bcrypt.hash(resolvedPassword, 12);

    const user = await prisma.user.create({
      data: {
        phone: normalPhone,
        ...(normalEmail && { email: normalEmail }),
        password: hashed,
        name,
        role: normalRole,
        ...(location && { location }),
        ...(profilePhoto && { profilePhoto }),
        ...(normalRole === 'PROVIDER' && {
          provider: {
            create: {
              category: category.toUpperCase(),
              businessName,
              ...(description && { description }),
              ...(workingHoursStart && { workingHoursStart }),
              ...(workingHoursEnd && { workingHoursEnd }),
              ...(idPhotoUrl && { idPhotoUrl }),
              ...(idBackPhotoUrl && { idBackPhotoUrl }),
              ...(Array.isArray(portfolioPhotos) && portfolioPhotos.length > 0 && { portfolioPhotos }),
              ...(coverImage && { coverImage }),
              ...(profileImage && { profileImage }),
              ...(Array.isArray(skills) && skills.length > 0 && { skills }),
              ...(yearsExperience && { yearsExperience }),
              ...(education && { education }),
              ...(Array.isArray(services) && services.length > 0 && {
                services: {
                  create: services.map((s) => ({
                    name: s.name,
                    price: Math.max(0, parseInt(s.price) || 0),
                    priceType: s.priceType || 'FIXED',
                    ...(s.duration && parseInt(s.duration) > 0 && { duration: parseInt(s.duration) }),
                    isActive: true,
                  })),
                },
              }),
              ...(Array.isArray(certificates) && certificates.length > 0 && {
                certificates: {
                  create: certificates.map((c) => ({
                    name: c.name,
                    fileUrl: c.fileUrl,
                    ...(c.publicId && { publicId: c.publicId }),
                  })),
                },
              }),
              ...(portfolioVideoUrl && {
                portfolioVideos: {
                  create: [{
                    url: portfolioVideoUrl,
                    ...(portfolioVideoPublicId && { publicId: portfolioVideoPublicId }),
                  }],
                },
              }),
            },
          },
        }),
      },
      include: { provider: { include: { services: true } } },
    });

    // Assign a unique referral code
    let referralCode;
    let attempts = 0;
    do {
      referralCode = generateReferralCode(name);
      attempts++;
    } while (attempts < 10 && await prisma.user.findUnique({ where: { referralCode } }));

    await prisma.user.update({ where: { id: user.id }, data: { referralCode } });

    // Handle incoming referral code
    if (incomingReferralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: incomingReferralCode } });
      if (referrer && referrer.id !== user.id) {
        const notificationSvc = require('../services/notification.service');
        await prisma.referral.create({
          data: {
            referrerId: referrer.id,
            referredId: user.id,
            code: incomingReferralCode,
            status: 'REGISTERED',
          },
        });

        await prisma.reward.create({
          data: {
            userId: user.id,
            type: 'FIRST_BOOKING_DISCOUNT',
            amount: 100,
            description: `KSh 100 off your first booking! Referred by ${referrer.name}`,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        notificationSvc.createNotification({
          userId: user.id,
          type: 'SYSTEM',
          title: '🎁 Welcome Bonus!',
          body: `You have KSh 100 off your first booking thanks to ${referrer.name}!`,
        }).catch(console.error);

        notificationSvc.createNotification({
          userId: referrer.id,
          type: 'SYSTEM',
          title: '🎉 Referral Registered!',
          body: `${name} just registered using your referral link! You will earn KSh 200 when they complete their first booking.`,
        }).catch(console.error);

        console.log(`🎁 Referral registered: ${referrer.name} referred ${name}`);
      }
    }

    // Start free trial for non-FUNDI business providers
    if (normalRole === 'PROVIDER' && category && category.toUpperCase() !== 'FUNDI' && user.provider) {
      const subSvc = require('../services/subscription.service');
      subSvc.createFreeTrial(user.provider.id).catch(console.error);
      console.log(`🎁 Free trial started for ${businessName}`);
    }

    const token = generateToken(user);
    console.log(`✅ Registered: ${user.name} (${user.role}) — ${user.phone}`);

    if (usedDefaultPassword) {
      const smsSvc = require('../services/sms.service');
      smsSvc.sendSMS(
        normalPhone,
        `Welcome to KaziShow! Your password is the last 6 digits of your phone number. Please change it in your profile settings.`
      ).catch(console.error);
    }

    res.status(201).json({ success: true, data: { user: sanitize(user), token } });
  } catch (err) {
    console.error('❌ Register error:', err.message);
    // Prisma unique constraint violation
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0] || 'field';
      const friendly = field === 'phone' ? 'Phone number already registered'
        : field === 'email' ? 'Email address already registered'
        : `${field} is already taken`;
      return res.status(409).json({ success: false, message: friendly });
    }
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
}

function normalizePhone(raw) {
  let p = raw.replace(/\s+/g, '');
  if (p.startsWith('0')) p = '+254' + p.slice(1);
  else if (p.startsWith('254') && !p.startsWith('+')) p = '+' + p;
  return p;
}

async function login(req, res) {
  try {
    const { phone, password, rememberMe } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'phone and password are required' });
    }

    const normalized = normalizePhone(phone);

    // Try normalized form first, then exact match as fallback (handles legacy accounts)
    let user = await prisma.user.findUnique({
      where: { phone: normalized },
      include: { provider: true },
    });
    if (!user && normalized !== phone.replace(/\s+/g, '')) {
      user = await prisma.user.findUnique({
        where: { phone: phone.replace(/\s+/g, '') },
        include: { provider: true },
      });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }
    if (!user.password) {
      return res.status(401).json({ success: false, message: 'This account uses Google Sign-In. Please sign in with Google.' });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }

    const expiresIn = rememberMe ? '30d' : '1d';
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn }
    );
    console.log(`🔑 Logged in: ${user.name} (${user.role}) — remember: ${!!rememberMe} — expires: ${expiresIn}`);

    res.json({ success: true, data: { user: sanitize(user), token } });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function refresh(req, res) {
  try {
    const token = generateToken(req.user);
    res.json({ success: true, data: { token } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function saveDeviceToken(req, res) {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken) {
      return res.status(400).json({ success: false, message: 'deviceToken is required' });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { deviceToken } });
    res.json({ success: true, data: { message: 'Device token saved' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'Google accounts do not have a password. Please use Google Sign-In.' });
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    console.log(`🔒 Password changed for user ${req.user.id}`);
    res.json({ success: true, data: { message: 'Password updated successfully' } });
  } catch (err) {
    console.error('❌ changePassword error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function googleAuth(req, res) {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ success: false, message: 'accessToken is required' });
    }

    // Verify token and fetch profile from Google
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }
    const profile = await resp.json();
    // profile: { sub, email, name, picture, email_verified }

    // Find existing user by googleId or email
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: profile.email }] },
      include: { provider: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId: profile.sub,
          email: profile.email,
          name: profile.name,
          profilePhoto: profile.picture,
          role: 'CUSTOMER',
          location: 'Nairobi',
          referralCode: generateReferralCode(profile.name),
        },
        include: { provider: true },
      });
      console.log(`✅ Google sign-up: ${user.name} (${user.email})`);
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.sub, ...(!user.profilePhoto && { profilePhoto: profile.picture }) },
        include: { provider: true },
      });
      console.log(`🔗 Google linked: ${user.name}`);
    } else {
      console.log(`🔑 Google login: ${user.name}`);
    }

    const token = generateToken(user);
    res.json({ success: true, data: { user: sanitize(user), token } });
  } catch (err) {
    console.error('❌ googleAuth error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deactivateAccount(req, res) {
  try {
    await prisma.user.update({ where: { id: req.user.id }, data: { isActive: false } });
    console.log(`🔒 Account deactivated for user ${req.user.id}`);
    res.json({ success: true, data: { message: 'Account deactivated successfully' } });
  } catch (err) {
    console.error('❌ deactivateAccount error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { register, login, refresh, saveDeviceToken, changePassword, deactivateAccount, googleAuth };
