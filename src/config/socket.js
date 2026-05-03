const { Server } = require('socket.io');
const prisma = require('./db');

let io;

// userId -> Set of socketIds (tracks multiple tabs/devices)
const connectedUsers = new Map();

// bookingId -> { lat, lng, updatedAt } — in-memory provider location cache
const locationCache = new Map();

// Live visitor count (all connected sockets, logged-in or not)
let liveVisitorCount = 0;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    liveVisitorCount++;
    io.emit('live_visitors', { count: liveVisitorCount });
    console.log('🔌 Socket connected:', socket.id);

    // ─── Room join ────────────────────────────────────────────────────────────
    socket.on('join', async (userId) => {
      socket.join(userId);
      socket.userId = userId;

      if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
      connectedUsers.get(userId).add(socket.id);

      // Mark online on first connection for this user
      if (connectedUsers.get(userId).size === 1) {
        try {
          await prisma.user.update({ where: { id: userId }, data: { isOnline: true } });
        } catch {}
        socket.broadcast.emit('user_online', { userId });
      }

      console.log(`👤 User ${userId} joined their room`);
    });

    // ─── Provider-specific events (existing) ─────────────────────────────────
    socket.on('provider_online', async ({ userId }) => {
      try {
        await prisma.user.update({ where: { id: userId }, data: { isOnline: true } });
        console.log(`🟢 Provider ${userId} is ONLINE`);
      } catch (err) {
        console.error('❌ provider_online error:', err.message);
      }
    });

    socket.on('provider_offline', async ({ userId }) => {
      try {
        await prisma.user.update({ where: { id: userId }, data: { isOnline: false } });
        console.log(`🔴 Provider ${userId} is OFFLINE`);
      } catch (err) {
        console.error('❌ provider_offline error:', err.message);
      }
    });

    // ─── Live provider location tracking ─────────────────────────────────────
    socket.on('provider_location', async ({ bookingId, lat, lng }) => {
      if (!bookingId || lat == null || lng == null) return;
      locationCache.set(bookingId, { lat, lng, updatedAt: Date.now() });
      try {
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { customerId: true },
        });
        if (booking) {
          io.to(booking.customerId).emit('provider_location_update', { bookingId, lat, lng });
        }
      } catch (err) {
        console.error('❌ provider_location error:', err.message);
      }
    });

    // ─── Chat events ──────────────────────────────────────────────────────────
    socket.on('send_message', async ({ receiverId, content, bookingId }) => {
      const senderId = socket.userId;
      if (!senderId || !receiverId || !content?.trim()) return;

      try {
        const message = await prisma.message.create({
          data: {
            senderId,
            receiverId,
            content: content.trim(),
            ...(bookingId && { bookingId }),
          },
          include: { sender: { select: { id: true, name: true } } },
        });
        io.to(receiverId).emit('new_message', message);
        // Also emit back to sender (other tabs)
        socket.to(senderId).emit('new_message', message);
      } catch (err) {
        console.error('❌ send_message error:', err.message);
      }
    });

    socket.on('typing_start', ({ receiverId }) => {
      if (socket.userId) {
        io.to(receiverId).emit('user_typing', { userId: socket.userId });
      }
    });

    socket.on('typing_stop', ({ receiverId }) => {
      if (socket.userId) {
        io.to(receiverId).emit('user_stop_typing', { userId: socket.userId });
      }
    });

    socket.on('mark_read', async ({ senderId }) => {
      const receiverId = socket.userId;
      if (!receiverId || !senderId) return;
      try {
        await prisma.message.updateMany({
          where: { senderId, receiverId, isRead: false },
          data: { isRead: true },
        });
        io.to(senderId).emit('message_read', { readBy: receiverId });
      } catch (err) {
        console.error('❌ mark_read error:', err.message);
      }
    });

    // ─── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      liveVisitorCount = Math.max(0, liveVisitorCount - 1);
      io.emit('live_visitors', { count: liveVisitorCount });
      console.log('🔌 Socket disconnected:', socket.id);
      const userId = socket.userId;
      if (!userId) return;

      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          connectedUsers.delete(userId);
          try {
            await prisma.user.update({ where: { id: userId }, data: { isOnline: false } });
          } catch {}
          io.emit('user_offline', { userId });
        }
      }
    });
  });

  return io;
}

function getIo() {
  if (!io) throw new Error('Socket.io not initialized — call initSocket first');
  return io;
}

module.exports = { initSocket, getIo, locationCache };
