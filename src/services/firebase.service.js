const { initFirebase, admin } = require('../config/firebase');

async function sendPushNotification({ deviceToken, title, body, data = {}, emoji = '🔔' }) {
  if (!deviceToken) return null;

  try {
    initFirebase();

    const stringData = Object.fromEntries(
      Object.entries({ ...data, emoji }).map(([k, v]) => [k, String(v)])
    );

    const message = {
      token: deviceToken,
      notification: { title, body },
      data: stringData,
      webpush: {
        notification: {
          title,
          body,
          icon: '/logo.png',
          badge: '/badge.png',
          requireInteraction: false,
        },
        fcm_options: { link: data.url || '/' },
      },
      android: {
        priority: 'high',
        notification: { title, body, color: '#FF6B2B', click_action: data.url || '/' },
      },
      apns: {
        payload: { aps: { alert: { title, body }, badge: 1, sound: 'default' } },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`🔔 Push sent: "${title}" → ${response}`);
    return response;
  } catch (err) {
    // Token invalid/expired — not a fatal error
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      console.warn(`⚠️ Stale FCM token — skipping`);
    } else {
      console.error('❌ Push notification failed:', err.message);
    }
    return null;
  }
}

async function sendPushToMultiple({ deviceTokens, title, body, data = {} }) {
  const validTokens = (deviceTokens || []).filter(Boolean);
  if (validTokens.length === 0) return null;

  try {
    initFirebase();

    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const response = await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification: { title, body },
      data: stringData,
    });

    console.log(`🔔 Multicast: ${response.successCount} sent, ${response.failureCount} failed`);
    return response;
  } catch (err) {
    console.error('❌ Multicast push failed:', err.message);
    return null;
  }
}

module.exports = { sendPushNotification, sendPushToMultiple };
