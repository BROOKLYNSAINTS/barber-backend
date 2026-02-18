// api/_auth.js
// Firebase Admin authentication helper for Vercel

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let firebaseAuth = null;

/**
 * Initialize Firebase Admin safely (once)
 */
function getFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth;

  if (!getApps().length) {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

    const privateKey =
      typeof rawPrivateKey === 'string'
        ? rawPrivateKey.replace(/\\n/g, '\n')
        : undefined;

    if (!projectId || !clientEmail || !privateKey) {
      console.error('❌ Firebase admin credentials missing');
      return null;
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  firebaseAuth = getAuth();
  return firebaseAuth;
}

/**
 * Verify Firebase ID token from Authorization header
 */
export async function verifyAuthToken(req) {
  try {
    const auth = getFirebaseAuth();
    if (!auth) return null;

    const authHeader =
      req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split('Bearer ')[1];
    if (!token) return null;

    const decoded = await auth.verifyIdToken(token);
    return decoded;
  } catch (error) {
    console.error(
      '❌ Firebase token verification failed:',
      error.message
    );
    return null;
  }
}

/**
 * Legacy compatibility helper
 */
export async function getAuthUser(req) {
  return verifyAuthToken(req);
}
