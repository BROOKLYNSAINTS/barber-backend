// api/_auth.js
// Firebase Auth verification middleware for Vercel serverless functions
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

/**
 * Verify Firebase Auth token from Authorization header
 * Returns the decoded token or null if invalid
 */
export async function verifyAuthToken(req) {
  try {
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
    
    const decodedToken = await getAuth().verifyIdToken(token);
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
