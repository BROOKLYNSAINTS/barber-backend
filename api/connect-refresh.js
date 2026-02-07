// api/connect-refresh.js
import Stripe from 'stripe';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { verifyAuthToken } from './_auth.js';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  // CORS + cache headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 1) GET = Stripe refresh_url → redirect back into app
  if (req.method === 'GET') {
    try {
      const query = req.query || {};
      const state = typeof query.state === 'string' ? query.state : '';
      const account = typeof query.account === 'string' ? query.account : '';

      const returnUrlRaw =
        typeof query.returnUrl === 'string' ? query.returnUrl : '';

      const fallbackReturnUrl = 'barberclean://stripe-connect-return';

      const baseReturnUrl = returnUrlRaw || fallbackReturnUrl;
      const hasQ = baseReturnUrl.includes('?');
      const joiner = hasQ ? '&' : '?';

      const redirectTo =
        `${baseReturnUrl}${joiner}` +
        `success=${encodeURIComponent('0')}` +
        `&refresh=1` +
        (state ? `&state=${encodeURIComponent(state)}` : '') +
        (account ? `&account=${encodeURIComponent(account)}` : '');

      console.log('🔄 Stripe Connect refresh. Redirecting to app:', redirectTo);

      res.statusCode = 302;
      res.setHeader('Location', redirectTo);
      return res.end();
    } catch (error) {
      console.error('❌ Error in GET /connect-refresh:', error);
      res.status(500).send('Error handling connect refresh');
      return;
    }
  }

  // 2) POST = app status check (refreshConnectAccountStatus)
  if (req.method === 'POST') {
    try {
      const user = await verifyAuthToken(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.body || {};
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(200).json({
          success: true,
          onboardingComplete: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
        });
      }

      const userData = userSnap.data() || {};
      const accountId = userData.stripeConnectAccountId || null;

      if (!accountId) {
        return res.status(200).json({
          success: true,
          onboardingComplete: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
        });
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
      if (!stripeKey) {
        return res.status(500).json({ error: 'Stripe secret key not configured' });
      }

      const stripe = new Stripe(stripeKey);
      const account = await stripe.accounts.retrieve(accountId);

      const chargesEnabled = !!account.charges_enabled;
      const payoutsEnabled = !!account.payouts_enabled;
      const detailsSubmitted = !!account.details_submitted;

      const onboardingComplete = detailsSubmitted && chargesEnabled;

      console.log('✅ Connect status for user:', userId, {
        accountId,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        onboardingComplete,
      });

      return res.status(200).json({
        success: true,
        onboardingComplete,
        accountId,
        chargesEnabled,
        payoutsEnabled,
      });
    } catch (error) {
      console.error('❌ Error in POST /connect-refresh:', error);
      return res.status(500).json({
        success: false,
        onboardingComplete: false,
        accountId: null,
        error: error.message || 'Failed to refresh Connect status',
      });
    }
  }

  // Other methods not allowed
  return res.status(405).json({ error: 'Method Not Allowed' });
}
