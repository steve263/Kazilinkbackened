const prisma = require('../config/db');
const { getIo } = require('../config/socket');

// GET /api/messages/conversations
async function getConversations(req, res) {
  try {
    const userId = req.user.id;

    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true, isOnline: true } },
        receiver: { select: { id: true, name: true, isOnline: true } },
      },
    });

    // One entry per partner, latest message first
    const convMap = new Map();
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      const partner = msg.senderId === userId ? msg.receiver : msg.sender;
      if (!convMap.has(partnerId)) {
        convMap.set(partnerId, { partner, lastMessage: msg, unreadCount: 0 });
      }
    }

    // Count unread per partner
    const unreadGroups = await prisma.message.groupBy({
      by: ['senderId'],
      where: { receiverId: userId, isRead: false },
      _count: { id: true },
    });
    for (const g of unreadGroups) {
      if (convMap.has(g.senderId)) {
        convMap.get(g.senderId).unreadCount = g._count.id;
      }
    }

    res.json({ success: true, data: Array.from(convMap.values()) });
  } catch (err) {
    console.error('getConversations:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load conversations' });
  }
}

// GET /api/messages/unread/count
async function getUnreadCount(req, res) {
  try {
    const count = await prisma.message.count({
      where: { receiverId: req.user.id, isRead: false },
    });
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get unread count' });
  }
}

// GET /api/messages/user-info/:userId
async function getUserInfo(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, name: true, isOnline: true, role: true },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get user info' });
  }
}

// GET /api/messages/:userId
async function getMessages(req, res) {
  try {
    const userId = req.user.id;
    const otherId = req.params.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherId },
          { senderId: otherId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { sender: { select: { id: true, name: true } } },
    });

    res.json({ success: true, data: messages.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
}

// POST /api/messages
async function sendMessage(req, res) {
  try {
    const { receiverId, content, bookingId } = req.body;
    const senderId = req.user.id;

    if (!receiverId || !content?.trim()) {
      return res.status(400).json({ success: false, message: 'receiverId and content are required' });
    }

    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: content.trim(),
        ...(bookingId && { bookingId }),
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    try {
      getIo().to(receiverId).emit('new_message', message);
    } catch {}

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error('sendMessage:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
}

// PUT /api/messages/:userId/read
async function markAsRead(req, res) {
  try {
    const userId = req.user.id;
    const senderId = req.params.userId;

    await prisma.message.updateMany({
      where: { senderId, receiverId: userId, isRead: false },
      data: { isRead: true },
    });

    try {
      getIo().to(senderId).emit('message_read', { readBy: userId });
    } catch {}

    res.json({ success: true, message: 'Messages marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
}

// POST /api/messages/upload  — image via multer/cloudinary
async function uploadImage(req, res) {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }
    res.json({ success: true, data: { url: req.file.path } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
}

// DELETE /api/messages/:messageId
async function deleteMessage(req, res) {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    if (message.senderId !== userId) return res.status(403).json({ success: false, message: 'Not your message' });

    await prisma.message.delete({ where: { id: messageId } });

    try {
      const io = getIo();
      io.to(message.receiverId).emit('message_deleted', { messageId });
      io.to(message.senderId).emit('message_deleted', { messageId });
    } catch {}

    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    console.error('deleteMessage:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete message' });
  }
}

module.exports = { getConversations, getUnreadCount, getUserInfo, getMessages, sendMessage, markAsRead, uploadImage, deleteMessage };
