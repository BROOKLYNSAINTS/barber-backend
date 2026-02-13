// api/connect-return.js
// Stripe Connect onboarding return_url handler
// LOGGING VERSION – shows EXACTLY what Stripe sends
// Will NOT overwrite accountId with null

import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

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
  // ─────────────────────────────────────────────
  // HEADERS
  // ─────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  // ─────────────────────────────────────────────
  // LOG EVERYTHING STRIPE SENDS
  // ─────────────────────────────────────────────
  console.log('🔥🔥🔥 CONNECT-RETURN HIT 🔥🔥🔥');
  console.log('req.query:', JSON.stringify(req.query, null, 2));

  const { state, account, returnUrl } = req.query || {};

  console.log('➡️ Parsed values:');
  console.log('state (userId):', state);
  console.log('account (acct id):', account);
  console.log('returnUrl:', returnUrl);
  console.log('account type:', typeof account);
  console.log('account length:', account?.length);

  // ─────────────────────────────────────────────
  // SAFE FIRESTORE UPDATE (NO NULL WRITES)
  // ─────────────────────────────────────────────
  if (
    typeof state === 'string' &&
    state.length &&
    typeof account === 'string' &&
    account.length
  ) {
    try {
      console.log('✍️ Writing Stripe Connect fields to Firestore');
      console.log({
        userId: state,
        stripeConnectAccountId: account,
        stripeConnectOnboardingComplete: true,
      });

      await db.collection('users').doc(state).update({
        stripeConnectAccountId: account,
        stripeConnectOnboardingComplete: true,
        updatedAt: new Date().toISOString(),
      });

      console.log('✅ Firestore updated successfully');
    } catch (err) {
      console.error('❌ Firestore update FAILED:', err);
      // DO NOT block redirect
    }
  } else {
    console.error('🚨 SKIPPED FIRESTORE UPDATE');
    console.error({
      reason: 'Missing or invalid state/account',
      state,
      account,
    });
  }

  // ─────────────────────────────────────────────
  // REDIRECT BACK TO APP
  // ─────────────────────────────────────────────
  const fallbackReturnUrl = 'barberclean://stripe-connect-return';

  const baseReturnUrl =
    typeof returnUrl === 'string' && returnUrl.length
      ? returnUrl
      : fallbackReturnUrl;

  const joiner = baseReturnUrl.includes('?') ? '&' : '?';

  const redirectTo =
    `${baseReturnUrl}${joiner}success=1` +
    (state ? `&state=${encodeURIComponent(state)}` : '') +
    (account ? `&account=${encodeURIComponent(account)}` : '');

  console.log('➡️ Redirecting to app:', redirectTo);

  res.statusCode = 302;
  res.setHeader('Location', redirectTo);
  return res.end();
}
