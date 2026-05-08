const prisma = require('../config/db');
const { cloudinary } = require('../middleware/upload');

const EXPIRY_MS = 24 * 60 * 60 * 1000;
const activeAfter = () => new Date(Date.now() - EXPIRY_MS);
const addExpiry = (v) => ({ ...v, expiresAt: new Date(new Date(v.createdAt).getTime() + EXPIRY_MS).toISOString() });

const VIDEO_USER_SELECT = {
  id: true,
  name: true,
  role: true,
  profilePhoto: true,
  provider: {
    select: { id: true, category: true, businessName: true, profileImage: true },
  },
};

// GET /api/videos — public (optionalAuth for likedByMe)
async function getVideos(req, res) {
  try {
    const { type, hashtag, limit = 20, offset = 0 } = req.query;

    const where = { createdAt: { gt: activeAfter() } };
    if (type === 'fundi') {
      where.user = { provider: { category: 'FUNDI' } };
    } else if (type === 'business') {
      where.user = {
        role: 'PROVIDER',
        provider: { category: { in: ['SHOP', 'HOTEL', 'RESTAURANT', 'TECH', 'PROFESSIONAL', 'BUSINESS'] } },
      };
    } else if (type === 'customer') {
      where.user = { role: 'CUSTOMER' };
    }

    if (hashtag) where.hashtags = { has: hashtag };

    const videos = await prisma.video.findMany({
      where,
      include: {
        user: { select: VIDEO_USER_SELECT },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const userId = req.user?.id || null;
    if (userId && videos.length > 0) {
      const videoIds = videos.map((v) => v.id);
      const myLikes = await prisma.videoLike.findMany({
        where: { userId, videoId: { in: videoIds } },
        select: { videoId: true },
      });
      const likedSet = new Set(myLikes.map((l) => l.videoId));
      return res.json({
        success: true,
        data: videos.map((v) => addExpiry({ ...v, likedByMe: likedSet.has(v.id) })),
      });
    }

    res.json({ success: true, data: videos.map((v) => addExpiry({ ...v, likedByMe: false })) });
  } catch (err) {
    console.error('❌ getVideos error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/videos — create video (auth required)
async function postVideo(req, res) {
  try {
    const { videoUrl, publicId, caption, hashtags, rating, providerId, thumbnailUrl, duration } = req.body;

    if (!videoUrl || !caption?.trim()) {
      return res.status(400).json({ success: false, message: 'videoUrl and caption are required' });
    }

    let parsedHashtags = [];
    if (typeof hashtags === 'string') {
      parsedHashtags = hashtags.split(',').map((h) => h.trim().replace(/^#/, '')).filter(Boolean).slice(0, 5);
    } else if (Array.isArray(hashtags)) {
      parsedHashtags = hashtags.map((h) => String(h).trim().replace(/^#/, '')).filter(Boolean).slice(0, 5);
    }

    let resolvedProviderId = providerId || null;
    if (req.user.role === 'PROVIDER') {
      const prov = await prisma.provider.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (prov) resolvedProviderId = prov.id;
    }

    const video = await prisma.video.create({
      data: {
        userId: req.user.id,
        providerId: resolvedProviderId,
        caption: caption.trim().slice(0, 300),
        videoUrl,
        publicId: publicId || null,
        thumbnailUrl: thumbnailUrl || null,
        hashtags: parsedHashtags,
        rating: rating ? parseInt(rating) : null,
        duration: duration ? parseInt(duration) : null,
      },
      include: {
        user: { select: VIDEO_USER_SELECT },
        _count: { select: { comments: true } },
      },
    });

    console.log(`🎬 Video posted by ${req.user.name}`);
    res.status(201).json({ success: true, data: addExpiry({ ...video, likedByMe: false }) });
  } catch (err) {
    console.error('❌ postVideo error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/videos/my — own videos (auth required)
async function getMyVideos(req, res) {
  try {
    const videos = await prisma.video.findMany({
      where: { userId: req.user.id },
      include: {
        user: { select: VIDEO_USER_SELECT },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const videoIds = videos.map((v) => v.id);
    const myLikes = await prisma.videoLike.findMany({
      where: { userId: req.user.id, videoId: { in: videoIds } },
      select: { videoId: true },
    });
    const likedSet = new Set(myLikes.map((l) => l.videoId));
    res.json({ success: true, data: videos.map((v) => addExpiry({ ...v, likedByMe: likedSet.has(v.id) })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/videos/booked-providers — providers user has booked (for customer upload modal)
async function getBookedProviders(req, res) {
  try {
    const bookings = await prisma.booking.findMany({
      where: { customerId: req.user.id, status: 'COMPLETED' },
      include: { provider: { select: { id: true, businessName: true, category: true, profileImage: true } } },
      distinct: ['providerId'],
    });
    const providers = bookings.map((b) => b.provider).filter(Boolean);
    res.json({ success: true, data: providers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/videos/:id — delete own video (auth required)
async function deleteVideo(req, res) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    if (video.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (video.publicId) {
      try { await cloudinary.uploader.destroy(video.publicId, { resource_type: 'video' }); }
      catch (e) { console.error('Cloudinary video delete failed:', e.message); }
    }

    await prisma.video.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/videos/:id/like — toggle like (auth required)
async function likeVideo(req, res) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    const existing = await prisma.videoLike.findUnique({
      where: { videoId_userId: { videoId: req.params.id, userId: req.user.id } },
    });

    let liked;
    if (existing) {
      await prisma.$transaction([
        prisma.videoLike.delete({ where: { videoId_userId: { videoId: req.params.id, userId: req.user.id } } }),
        prisma.video.update({ where: { id: req.params.id }, data: { likes: { decrement: 1 } } }),
      ]);
      liked = false;
    } else {
      await prisma.$transaction([
        prisma.videoLike.create({ data: { videoId: req.params.id, userId: req.user.id } }),
        prisma.video.update({ where: { id: req.params.id }, data: { likes: { increment: 1 } } }),
      ]);
      liked = true;
    }

    const updated = await prisma.video.findUnique({ where: { id: req.params.id }, select: { likes: true } });
    res.json({ success: true, data: { liked, likes: Math.max(0, updated.likes) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/videos/:id/comments — get comments (public)
async function getComments(req, res) {
  try {
    const comments = await prisma.videoComment.findMany({
      where: { videoId: req.params.id },
      include: { user: { select: { id: true, name: true, profilePhoto: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/videos/:id/comments — add comment (auth required)
async function addComment(req, res) {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Comment content is required' });

    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    const comment = await prisma.videoComment.create({
      data: { videoId: req.params.id, userId: req.user.id, content: content.trim().slice(0, 500) },
      include: { user: { select: { id: true, name: true, profilePhoto: true } } },
    });

    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/videos/:id/report — report video (auth required)
async function reportVideo(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required' });

    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    const existing = await prisma.videoReport.findUnique({
      where: { videoId_userId: { videoId: req.params.id, userId: req.user.id } },
    });
    if (existing) return res.status(409).json({ success: false, message: 'You have already reported this video' });

    const [, updated] = await prisma.$transaction([
      prisma.videoReport.create({ data: { videoId: req.params.id, userId: req.user.id, reason } }),
      prisma.video.update({ where: { id: req.params.id }, data: { reportCount: { increment: 1 } } }),
    ]);

    if (updated.reportCount >= 3) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          prisma.notification.create({
            data: {
              userId: admin.id,
              type: 'SYSTEM',
              title: '🚨 Video Reported',
              body: `A video has been reported ${updated.reportCount} times and needs review.`,
            },
          })
        )
      );
    }

    res.json({ success: true, data: { reported: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Admin functions ──────────────────────────────────────────────────────────

async function adminGetVideos(req, res) {
  try {
    const { reported } = req.query;
    const where = reported === 'true' ? { reportCount: { gt: 0 } } : {};

    const videos = await prisma.video.findMany({
      where,
      include: {
        user: { select: VIDEO_USER_SELECT },
        _count: { select: { comments: true, reports: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminDeleteVideo(req, res) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    if (video.publicId) {
      try { await cloudinary.uploader.destroy(video.publicId, { resource_type: 'video' }); }
      catch (e) { console.error('Cloudinary video delete failed:', e.message); }
    }

    await prisma.video.delete({ where: { id: req.params.id } });
    console.log(`🗑️ Admin deleted video ${req.params.id}`);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getVideos,
  postVideo,
  getMyVideos,
  getBookedProviders,
  deleteVideo,
  likeVideo,
  getComments,
  addComment,
  reportVideo,
  adminGetVideos,
  adminDeleteVideo,
};
