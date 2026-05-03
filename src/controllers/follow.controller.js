const prisma = require('../config/db');

async function toggleFollow(req, res) {
  try {
    const { providerId } = req.params;

    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const existing = await prisma.follow.findUnique({
      where: { followerId_providerId: { followerId: req.user.id, providerId } },
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
    } else {
      await prisma.follow.create({ data: { followerId: req.user.id, providerId } });
    }

    const followersCount = await prisma.follow.count({ where: { providerId } });
    res.json({ success: true, data: { followed: !existing, followersCount } });
  } catch (err) {
    console.error('❌ toggleFollow error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { toggleFollow };
