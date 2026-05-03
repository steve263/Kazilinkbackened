const prisma = require('../config/db');

async function getNotifications(req, res) {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        include: { booking: { select: { id: true, status: true, totalAmount: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.notification.count({ where: { userId: req.user.id } }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount: unread,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    console.error('❌ getNotifications error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markRead(req, res) {
  try {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (notification.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getUnreadCount(req, res) {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    });
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAllRead(req, res) {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });

    console.log(`📬 Marked ${count} notifications as read for user ${req.user.id}`);
    res.json({ success: true, data: { updated: count } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getNotifications, getUnreadCount, markRead, markAllRead };
