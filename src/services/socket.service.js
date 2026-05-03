const { getIo } = require('../config/socket');

function emitToUser(userId, event, data) {
  try {
    const io = getIo();
    io.to(userId).emit(event, data);
    console.log(`📡 Emitted "${event}" to user ${userId}`);
  } catch (err) {
    console.error(`❌ Socket emit failed (${event}):`, err.message);
  }
}

// ─── Provider-facing events ────────────────────────────────────────────────────

function emitNewBooking(providerUserId, payload) {
  emitToUser(providerUserId, 'new_booking', payload);
}

function emitBookingCancelled(providerUserId, payload) {
  emitToUser(providerUserId, 'booking_cancelled', payload);
}

function emitPaymentReceived(providerUserId, payload) {
  emitToUser(providerUserId, 'payment_received', payload);
}

// ─── Customer-facing events ────────────────────────────────────────────────────

function emitBookingAccepted(customerUserId, payload) {
  emitToUser(customerUserId, 'booking_accepted', payload);
}

function emitBookingDeclined(customerUserId, payload) {
  emitToUser(customerUserId, 'booking_declined', payload);
}

function emitProviderEnRoute(customerUserId, payload) {
  emitToUser(customerUserId, 'provider_en_route', payload);
}

function emitProviderArrived(customerUserId, payload) {
  emitToUser(customerUserId, 'provider_arrived', payload);
}

module.exports = {
  emitToUser,
  emitNewBooking,
  emitBookingCancelled,
  emitPaymentReceived,
  emitBookingAccepted,
  emitBookingDeclined,
  emitProviderEnRoute,
  emitProviderArrived,
};
