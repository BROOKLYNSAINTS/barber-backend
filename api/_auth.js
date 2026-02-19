// api/_auth.js
// Uses Firebase Admin from _firebaseAdmin.js

import { adminAuth } from './_firebaseAdmin.js';

/**
 * Verify Firebase ID token from Authorization header
 */
export async function verifyAuthToken(req) {
  try {
    const authHeader =
      req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split('Bearer ')[1];
    if (!token) return null;

    const decoded = await adminAuth.verifyIdToken(token);
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
