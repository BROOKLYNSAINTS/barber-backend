// api/create-account-link.js
import Stripe from 'stripe';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const bypassSecret = req.query['x-vercel-protection-bypass'];
  if (bypassSecret !== process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { barberId, email, name, returnUrl, refreshUrl } = req.body;
    
    if (!barberId || !email || !returnUrl || !refreshUrl) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY);
    
    // Check if account already exists
    let account;
    try {
      const accounts = await stripe.accounts.list({
        limit: 1,
        email: email,
      });
      
      account = accounts.data[0];
    } catch (err) {
      console.error('Error finding account:', err);
    }
    
    // Create a new account if one doesn't exist
    if (!account) {
      account = await stripe.accounts.create({
        type: 'express',
        email: email,
        metadata: {
          barberId: barberId,
        },
        business_profile: {
          name: name || 'Barber Service',
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      
      // Store the account ID directly in Firestore
      try {
        // Using the barberId as the document ID in the users collection
        await db.collection('users').doc(barberId).update({
          stripeAccountId: account.id,
          stripeAccountCreatedAt: new Date().toISOString(),
          stripeAccountSetupComplete: false,
        });
        console.log(`Stripe account ID ${account.id} stored for barber ${barberId}`);
      } catch (dbError) {
        console.error('Error storing Stripe account ID:', dbError);
        // Continue even if this fails - we have the account created in Stripe
      }
    }
    
    // Create an account link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    
    return res.status(200).json({ url: accountLink.url });
  } catch (error) {
    console.error('Error creating Stripe Connect account:', error);
    return res.status(500).json({ error: error.message });
  }
}