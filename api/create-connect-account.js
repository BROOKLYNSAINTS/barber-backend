// api/create-connect-account.js
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
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Auth
  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      userId,
      email,
      businessType = 'individual',
      returnUrl,  // expected: barberclean://stripe-connect-return (or Expo dev URL)
      refreshUrl, // optional
    } = req.body || {};

    console.log('📝 Creating Stripe Connect account for user:', userId);

    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!email) return res.status(400).json({ error: 'email is required' });

    // Stripe init
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe secret key not configured' });
    }
    const stripe = new Stripe(stripeKey);

    // Create Express Connect account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: businessType,
      metadata: { userId },
    });

    console.log('✅ Stripe Connect account created:', account.id);

    // Save account ID to Firestore
    await db.collection('users').doc(userId).update({
      stripeConnectAccountId: account.id,
      stripeConnectOnboardingComplete: false,
    });

    console.log('✅ Saved stripeConnectAccountId to Firestore');

    // Your API base (override-able)
    const API_BASE =
      process.env.PUBLIC_API_BASE_URL || 'https://barber-backend-ten.vercel.app';

    // Fallback if app doesn't send returnUrl
    const fallbackAppReturnUrl = 'barberclean://stripe-connect-return';

    const appReturnUrl =
      typeof returnUrl === 'string' && returnUrl.length ? returnUrl : fallbackAppReturnUrl;

    // If refreshUrl isn't supplied, reuse returnUrl
    const appRefreshUrl =
      typeof refreshUrl === 'string' && refreshUrl.length ? refreshUrl : appReturnUrl;

    // Build endpoint URLs that Stripe will redirect to
    const stripeReturnEndpoint =
      `${API_BASE}/api/connect-return?returnUrl=${encodeURIComponent(appReturnUrl)}` +
      `&account=${encodeURIComponent(account.id)}` +
      `&state=${encodeURIComponent(userId)}`;

    const stripeRefreshEndpoint =
      `${API_BASE}/api/connect-refresh?returnUrl=${encodeURIComponent(appRefreshUrl)}` +
      `&account=${encodeURIComponent(account.id)}` +
      `&state=${encodeURIComponent(userId)}`;

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url: stripeReturnEndpoint,
      refresh_url: stripeRefreshEndpoint,
    });

    console.log('✅ Onboarding link created:', accountLink.url);

    return res.status(200).json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
    });
  } catch (error) {
    console.error('❌ Error creating Connect account:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to create Connect account',
    });
  }
}
