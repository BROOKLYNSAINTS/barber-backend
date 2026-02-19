// api/_firebaseAdmin.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  const privateKey =
    typeof rawPrivateKey === 'string'
      ? rawPrivateKey.replace(/\\n/g, '\n')
      : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    console.error('❌ Firebase admin credentials missing');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
export default admin;
