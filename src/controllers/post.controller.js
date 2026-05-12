const prisma = require('../config/db');

const POST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Fire-and-forget: delete posts older than 24 hours from the DB
function cleanupExpiredPosts() {
  const cutoff = new Date(Date.now() - POST_TTL_MS);
  prisma.post.deleteMany({ where: { createdAt: { lt: cutoff } } })
    .then(({ count }) => { if (count > 0) console.log(`🧹 Deleted ${count} expired post(s)`); })
    .catch(console.error);
}

const POST_INCLUDE = {
  provider: {
    select: {
      id: true,
      businessName: true,
      category: true,
      badge: true,
      isVerified: true,
      user: { select: { id: true, name: true, location: true, lat: true, lng: true } },
    },
  },
  _count: { select: { likes: true, comments: true } },
};

// ─── GET /api/posts ───────────────────────────────────────────────────────────

async function getPosts(req, res) {
  try {
    cleanupExpiredPosts();

    const { type, hashtag, providerId, followed } = req.query;

    const cutoff = new Date(Date.now() - POST_TTL_MS);
    const where = { createdAt: { gte: cutoff } };
    if (type) where.type = type.toUpperCase();
    if (hashtag) where.hashtags = { has: hashtag.startsWith('#') ? hashtag : `#${hashtag}` };
    if (providerId) where.providerId = providerId;

    // If followed=true, filter by providers the user follows
    if (followed === 'true' && req.user) {
      const follows = await prisma.follow.findMany({
        where: { followerId: req.user.id },
        select: { providerId: true },
      });
      where.providerId = { in: follows.map((f) => f.providerId) };
    }

    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Attach isLiked for authenticated user
    let likedPostIds = new Set();
    let followedProviderIds = new Set();
    if (req.user) {
      const [likes, follows] = await Promise.all([
        prisma.like.findMany({ where: { userId: req.user.id }, select: { postId: true } }),
        prisma.follow.findMany({ where: { followerId: req.user.id }, select: { providerId: true } }),
      ]);
      likedPostIds = new Set(likes.map((l) => l.postId));
      followedProviderIds = new Set(follows.map((f) => f.providerId));
    }

    const enriched = posts.filter((p) => p.provider).map((p) => ({
      id: p.id,
      caption: p.caption,
      image: p.image,
      type: p.type,
      hashtags: p.hashtags,
      discountPct: p.discountPct,
      originalPrice: p.originalPrice,
      discountedPrice: p.discountedPrice,
      promoUntil: p.promoUntil,
      createdAt: p.createdAt,
      likesCount: p._count.likes,
      commentsCount: p._count.comments,
      isLiked: likedPostIds.has(p.id),
      provider: {
        ...p.provider,
        isFollowed: followedProviderIds.has(p.provider.id),
      },
    }));

    res.json({ success: true, data: { posts: enriched, total: enriched.length } });
  } catch (err) {
    console.error('❌ getPosts error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /api/posts ──────────────────────────────────────────────────────────

async function createPost(req, res) {
  try {
    const { caption, image, type = 'WORK', hashtags = [], discountPct, originalPrice, discountedPrice, promoUntil } = req.body;

    if (!caption) return res.status(400).json({ success: false, message: 'caption is required' });

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider profile not found' });

    // Extract hashtags from caption if not explicitly provided
    const captionTags = (caption.match(/#\w+/g) || []);
    const allTags = [...new Set([...hashtags, ...captionTags])];

    const post = await prisma.post.create({
      data: {
        providerId: provider.id,
        caption,
        image: image || null,
        type: type.toUpperCase(),
        hashtags: allTags,
        discountPct: discountPct ? parseInt(discountPct) : null,
        originalPrice: originalPrice ? parseInt(originalPrice) : null,
        discountedPrice: discountedPrice ? parseInt(discountedPrice) : null,
        promoUntil: promoUntil ? new Date(promoUntil) : null,
      },
      include: POST_INCLUDE,
    });

    console.log(`📸 New post by ${provider.businessName}: ${post.id}`);

    res.status(201).json({
      success: true,
      data: {
        ...post,
        likesCount: 0,
        commentsCount: 0,
        isLiked: false,
        provider: { ...post.provider, isFollowed: false },
      },
    });
  } catch (err) {
    console.error('❌ createPost error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /api/posts/:id/like ──────────────────────────────────────────────────

async function toggleLike(req, res) {
  try {
    const existing = await prisma.like.findUnique({
      where: { postId_userId: { postId: req.params.id, userId: req.user.id } },
    });

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
    } else {
      await prisma.like.create({ data: { postId: req.params.id, userId: req.user.id } });
    }

    const likesCount = await prisma.like.count({ where: { postId: req.params.id } });
    res.json({ success: true, data: { liked: !existing, likesCount } });
  } catch (err) {
    console.error('❌ toggleLike error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /api/posts/:id/comments ─────────────────────────────────────────────

async function getComments(req, res) {
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: req.params.id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /api/posts/:id/comments ────────────────────────────────────────────

async function addComment(req, res) {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'content is required' });

    const comment = await prisma.comment.create({
      data: { postId: req.params.id, userId: req.user.id, content: content.trim() },
      include: { user: { select: { id: true, name: true } } },
    });

    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyPosts(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider profile not found' });

    const posts = await prisma.post.findMany({
      where: { providerId: provider.id },
      include: { _count: { select: { likes: true, comments: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { posts } });
  } catch (err) {
    console.error('❌ getMyPosts error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deletePost(req, res) {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: { provider: true },
    });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.provider.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await prisma.post.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    console.error('❌ deletePost error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getPosts, createPost, toggleLike, getComments, addComment, getMyPosts, deletePost };
