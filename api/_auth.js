// api/_auth.js
// Firebase Auth verification middleware for Vercel serverless functions
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let authClient = null;
let authInitAttempted = false;

function getFirebaseAuthClient() {
  if (authClient) return authClient;
  if (authInitAttempted) return null;
  authInitAttempted = true;

  try {
    if (!getApps().length) {
      const projectId =
        process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
      const clientEmail =
        process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
      const rawPrivateKey =
        process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;
      const privateKey = typeof rawPrivateKey === 'string'
        ? rawPrivateKey.replace(/\\n/g, '\n')
        : undefined;

      if (!projectId || !clientEmail || !privateKey) {
        console.error('❌ Firebase admin credentials are not fully configured');
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

    authClient = getAuth();
    return authClient;
  } catch (error) {
    console.error('❌ Firebase admin init failed:', error?.message || error);
    return null;
  }
}

/**
 * Verify Firebase Auth token from Authorization header
 * Returns the decoded token or null if invalid
 */
export async function verifyAuthToken(req) {
  try {
    const auth = getFirebaseAuthClient();
    if (!auth) {
      return null;
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No Bearer token found in Authorization header');
      return null;
    }
    
    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      console.log('❌ Empty token');
      return null;
    }
    
    const decodedToken = await auth.verifyIdToken(token);
    console.log('✅ Auth verified for user:', decodedToken.uid);
    return decodedToken;
    
  } catch (error) {
    console.error('❌ Auth verification failed:', error.message);
    return null;
  }
}

/**
 * Middleware to require authentication
 * Use this in your API routes
 */
export function requireAuth(handler) {
  return async (req, res) => {
    const decodedToken = await verifyAuthToken(req);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Valid authentication token required'
      });
    }
    
    // Attach user info to request
    req.user = decodedToken;
    
    // Call the actual handler
    return handler(req, res);
  };
}
