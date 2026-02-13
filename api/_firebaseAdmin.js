// api/_firebaseAdmin.js
import admin from 'firebase-admin';

function getPrivateKey() {
  // Vercel env vars often store \n literally
  const key = process.env.FIREBASE_PRIVATE_KEY;
  return key ? key.replace(/\\n/g, '\n') : undefined;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  });
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
export default admin;
