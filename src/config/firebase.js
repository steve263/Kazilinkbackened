const admin = require('firebase-admin');

let firebaseApp;

function initFirebase() {
  if (firebaseApp) return firebaseApp;

  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');

    const serviceAccount = JSON.parse(raw);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('🔥 Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
  }

  return firebaseApp;
}

module.exports = { initFirebase, admin };
