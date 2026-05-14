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
    const handleJoin = async (userId) => {
      socket.join(userId);
      socket.userId = userId;
      if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
      connectedUsers.get(userId).add(socket.id);
      if (connectedUsers.get(userId).size === 1) {
        try { await prisma.user.update({ where: { id: userId }, data: { isOnline: true } }); } catch {}
        socket.broadcast.emit('user_online', { userId });
      }
      console.log(`👤 User ${userId} joined their room`);
    };

    socket.on('join', handleJoin);
    socket.on('join_room', handleJoin);

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
    socket.on('provider_location', async ({ bookingId, lat, lng, heading, speed }) => {
      if (!bookingId || lat == null || lng == null) return;
      locationCache.set(bookingId, { lat, lng, heading, updatedAt: Date.now() });
      try {
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: { provider: { select: { id: true, businessName: true } } },
        });
        if (!booking) return;

        // Persist to DB
        await prisma.providerLocation.upsert({
          where: { providerId: booking.providerId },
          create: { providerId: booking.providerId, lat, lng, heading, speed },
          update: { lat, lng, heading, speed },
        }).catch(() => {});

        // Calculate distance + ETA if booking has customer coordinates
        let distance = null;
        let etaMinutes = null;
        if (booking.lat != null && booking.lng != null) {
          distance = haversineKm(lat, lng, booking.lat, booking.lng);
          etaMinutes = Math.round((distance / 30) * 60);
        }

        io.to(booking.customerId).emit('provider_location_update', {
          bookingId, lat, lng, heading,
          distance: distance != null ? Math.round(distance * 10) / 10 : null,
          etaMinutes,
          providerName: booking.provider.businessName,
        });
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

    // ─── Audio call signaling ─────────────────────────────────────────────────
    socket.on('call_user', (data) => {
      const { to, from, callerName, callerRole, callerAvatar, signal } = data;
      console.log(`📞 Call from ${from} → ${to}`);
      io.to(to).emit('incoming_call', { from, callerName, callerRole, callerAvatar, signal });
    });

    socket.on('accept_call', (data) => {
      console.log(`✅ Call accepted → ${data.to}`);
      io.to(data.to).emit('call_accepted', { signal: data.signal });
    });

    socket.on('decline_call', async (data) => {
      const declinerId = socket.userId;
      console.log(`❌ Call declined → ${data.to}`);
      io.to(data.to).emit('call_declined');
      // Save missed call record
      if (declinerId && data.to) {
        try {
          const msg = await prisma.message.create({
            data: { senderId: data.to, receiverId: declinerId, content: '📞 Missed call' },
            include: { sender: { select: { id: true, name: true } } },
          });
          io.to(declinerId).emit('new_message', msg);
          io.to(data.to).emit('new_message', msg);
        } catch {}
      }
    });

    socket.on('end_call', async (data) => {
      const enderId = socket.userId;
      const { to, duration } = data || {};
      console.log(`📵 Call ended → ${to}`);
      if (to) io.to(to).emit('call_ended');
      // Save call record if call was actually connected (has duration)
      if (enderId && to && duration) {
        try {
          const msg = await prisma.message.create({
            data: { senderId: enderId, receiverId: to, content: `📞 Audio call — ${duration}` },
            include: { sender: { select: { id: true, name: true } } },
          });
          io.to(to).emit('new_message', msg);
          io.to(enderId).emit('new_message', msg);
        } catch {}
      }
    });

    socket.on('ice_candidate', (data) => {
      if (data.to) io.to(data.to).emit('ice_candidate', { candidate: data.candidate });
    });

    // ─── Video call signaling ─────────────────────────────────────────────────
    socket.on('video_call_offer', (data) => {
      const { to, from, fromName, fromPhoto, signal } = data;
      console.log(`🎥 Video call from ${from} → ${to}`);
      io.to(to).emit('incoming_video_call', { from, fromName, fromPhoto, signal });
    });

    socket.on('video_call_answer', (data) => {
      console.log(`✅ Video call answered → ${data.to}`);
      io.to(data.to).emit('video_call_answered', { signal: data.signal });
    });

    socket.on('video_call_ended', (data) => {
      if (data.to) io.to(data.to).emit('video_call_ended', {});
    });

    socket.on('video_call_rejected', (data) => {
      if (data.to) io.to(data.to).emit('video_call_rejected', {});
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

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { initSocket, getIo, locationCache };
