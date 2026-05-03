const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailSvc = require('../services/email.service');

const IMAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
function imageExpired(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > IMAGE_TTL_MS;
}
function expireCoverImage(tip) {
  return { ...tip, coverImage: imageExpired(tip.createdAt) ? null : tip.coverImage };
}

// POST - Submit tip (logged in user)
exports.createTip = async (req, res) => {
  try {
    const { title, content, excerpt, coverImage, category, status } = req.body;
    const authorId = req.user.id;

    if (!title || !content || !excerpt || !category) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const tip = await prisma.tip.create({
      data: {
        title,
        content,
        excerpt,
        coverImage: coverImage || null,
        category,
        authorId,
        status: status || 'PENDING',
      },
      include: { author: true },
    });

    if (status === 'PENDING' || !status) {
      const adminUsers = await prisma.user.findMany({ where: { role: 'ADMIN' } });
      for (const admin of adminUsers) {
        await prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'SYSTEM',
            title: 'New Guide Submitted',
            body: `New guide submitted by ${req.user.name}: ${title}`,
          },
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Guide submitted successfully',
      data: tip,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - All approved tips (public)
exports.getApprovedTips = async (req, res) => {
  try {
    const { category, sort = 'latest', skip = 0, limit = 10 } = req.query;
    const where = { status: 'APPROVED' };
    if (category) where.category = category;

    let orderBy = { createdAt: 'desc' };
    if (sort === 'most-viewed') orderBy = { views: 'desc' };
    if (sort === 'most-liked') orderBy = { likes: 'desc' };

    const tips = await prisma.tip.findMany({
      where,
      include: { author: true, comments: true },
      orderBy,
      skip: parseInt(skip),
      take: parseInt(limit),
    });

    const total = await prisma.tip.count({ where });

    res.json({
      success: true,
      data: tips.map(expireCoverImage),
      pagination: { skip: parseInt(skip), limit: parseInt(limit), total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - Single tip (public, increments views)
exports.getTipById = async (req, res) => {
  try {
    const { id } = req.params;

    const tip = await prisma.tip.update({
      where: { id },
      data: { views: { increment: 1 } },
      include: { author: true, comments: { include: { user: true } } },
    });

    res.json({ success: true, data: expireCoverImage(tip) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - My tips (auth required)
exports.getMyTips = async (req, res) => {
  try {
    const authorId = req.user.id;
    const tips = await prisma.tip.findMany({
      where: { authorId },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: tips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Edit tip (auth required)
exports.updateTip = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, excerpt, coverImage, category } = req.body;
    const authorId = req.user.id;

    const tip = await prisma.tip.findUnique({ where: { id } });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip not found' });
    if (tip.authorId !== authorId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updated = await prisma.tip.update({
      where: { id },
      data: {
        title: title || tip.title,
        content: content || tip.content,
        excerpt: excerpt || tip.excerpt,
        coverImage: coverImage || tip.coverImage,
        category: category || tip.category,
      },
      include: { author: true },
    });

    res.json({ success: true, message: 'Tip updated', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE - Delete tip
exports.deleteTip = async (req, res) => {
  try {
    const { id } = req.params;
    const authorId = req.user.id;

    const tip = await prisma.tip.findUnique({ where: { id } });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip not found' });
    if (tip.authorId !== authorId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.tip.delete({ where: { id } });
    res.json({ success: true, message: 'Tip deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST - Add comment to tip
exports.addTipComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content) return res.status(400).json({ success: false, message: 'Comment required' });

    const comment = await prisma.tipComment.create({
      data: { tipId: id, userId, content },
      include: { user: true },
    });

    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Like tip
exports.likeTip = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await prisma.tip.update({
      where: { id },
      data: { likes: { increment: 1 } },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - Admin pending tips
exports.getAdminPendingTips = async (req, res) => {
  try {
    const tips = await prisma.tip.findMany({
      where: { status: 'PENDING' },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: tips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET - Admin approved tips
exports.getAdminApprovedTips = async (req, res) => {
  try {
    const tips = await prisma.tip.findMany({
      where: { status: 'APPROVED' },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: tips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Admin approve tip
exports.approveTip = async (req, res) => {
  try {
    const { id } = req.params;

    const tip = await prisma.tip.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { author: true },
    });

    await prisma.notification.create({
      data: {
        userId: tip.authorId,
        type: 'SYSTEM',
        title: 'Your Guide is Live!',
        body: `Your guide "${tip.title}" is now live on KaziShow!`,
      },
    });

    emailSvc.sendEmail({
      to: tip.author.email,
      subject: '📖 Your KaziShow Guide is Now Live!',
      html: emailSvc.tplTipApproved({ authorName: tip.author.name, tipTitle: tip.title }),
    }).catch(console.error);

    res.json({ success: true, message: 'Tip approved', data: tip });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT - Admin reject tip
exports.rejectTip = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const tip = await prisma.tip.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
      include: { author: true },
    });

    await prisma.notification.create({
      data: {
        userId: tip.authorId,
        type: 'SYSTEM',
        title: 'Guide Not Approved',
        body: `Your guide was not approved. Reason: ${reason}. Edit and resubmit.`,
      },
    });

    emailSvc.sendEmail({
      to: tip.author.email,
      subject: 'Your KaziShow Guide Was Not Approved',
      html: emailSvc.tplTipRejected({ authorName: tip.author.name, tipTitle: tip.title, reason }),
    }).catch(console.error);

    res.json({ success: true, message: 'Tip rejected', data: tip });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
