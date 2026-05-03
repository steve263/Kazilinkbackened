const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailSvc = require('../services/email.service');

// POST - Submit testimonial (customer auth required)
exports.submitTestimonial = async (req, res) => {
  try {
    const { videoUrl, thumbnailUrl, summary, rating, category, providerId } = req.body;
    const customerId = req.user.id;

    if (!videoUrl || !summary || !rating || !category) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    const testimonial = await prisma.testimonial.create({
      data: {
        customerId,
        providerId: providerId || null,
        videoUrl,
        thumbnailUrl: thumbnailUrl || null,
        summary,
        rating,
        category,
        status: 'PENDING',
      },
      include: { customer: true },
    });

    // Send admin notification
    const adminUsers = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of adminUsers) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'SYSTEM',
          title: 'New Testimonial Submitted',
          body: `New testimonial submitted by ${req.user.name}`,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Testimonial submitted successfully. It will appear within 24 hours.',
      data: testimonial,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - All approved testimonials (public)
exports.getApprovedTestimonials = async (req, res) => {
  try {
    const { category, skip = 0, limit = 10 } = req.query;
    const where = { status: 'APPROVED' };
    if (category) where.category = category;

    const testimonials = await prisma.testimonial.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      skip: parseInt(skip),
      take: parseInt(limit),
    });

    const total = await prisma.testimonial.count({ where });

    res.json({
      success: true,
      data: testimonials,
      pagination: { skip: parseInt(skip), limit: parseInt(limit), total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - My testimonials (auth required)
exports.getMyTestimonials = async (req, res) => {
  try {
    const customerId = req.user.id;
    const testimonials = await prisma.testimonial.findMany({
      where: { customerId },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: testimonials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Admin approve testimonial
exports.approveTestimonial = async (req, res) => {
  try {
    const { id } = req.params;

    const testimonial = await prisma.testimonial.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { customer: true },
    });

    // Notify customer
    await prisma.notification.create({
      data: {
        userId: testimonial.customerId,
        type: 'SYSTEM',
        title: 'Your Testimonial is Live!',
        body: 'Your testimonial is now visible on KaziShow',
      },
    });

    emailSvc.sendEmail({
      to: testimonial.customer.email,
      subject: '🌟 Your KaziShow Testimonial is Live!',
      html: emailSvc.tplTestimonialApproved({ customerName: testimonial.customer.name }),
    }).catch(console.error);

    res.json({ success: true, message: 'Testimonial approved', data: testimonial });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Admin reject testimonial
exports.rejectTestimonial = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const testimonial = await prisma.testimonial.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason || null },
      include: { customer: true },
    });

    // Notify customer
    await prisma.notification.create({
      data: {
        userId: testimonial.customerId,
        type: 'SYSTEM',
        title: 'Testimonial Not Approved',
        body: `Your testimonial was not approved. Reason: ${reason}`,
      },
    });

    emailSvc.sendEmail({
      to: testimonial.customer.email,
      subject: 'Your KaziShow Testimonial Was Not Approved',
      html: emailSvc.tplTestimonialRejected({ customerName: testimonial.customer.name, reason }),
    }).catch(console.error);

    res.json({ success: true, message: 'Testimonial rejected', data: testimonial });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Increment views
exports.incrementTestimonialViews = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.testimonial.update({
      where: { id },
      data: { views: { increment: 1 } },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - Admin pending testimonials
exports.getPendingTestimonials = async (req, res) => {
  try {
    const testimonials = await prisma.testimonial.findMany({
      where: { status: 'PENDING' },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: testimonials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
