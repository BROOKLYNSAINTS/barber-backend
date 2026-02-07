// api/create-account-link.js - FIXED VERSION
import Stripe from 'stripe';

export default async function handler(req, res) {
  // CORS headers
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
    console.log('Creating account link, request body:', req.body);
    
    // Extract parameters from request - support both naming conventions
    const { barberId, email } = req.body;
    const name = req.body.name || 'Barber Business';
    
    // Default return/refresh URLs if not provided
    const returnUrl = req.body.returnUrl || req.body.return_url || 'barberscheduler://stripe-connect-return';
    const refreshUrl = req.body.refreshUrl || req.body.refresh_url || 'barberscheduler://stripe-connect-refresh';
    
    if (!barberId || !email) {
      console.error('Missing required parameters:', { barberId, email });
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Initialize Stripe
    const stripeKey = process.env.STRIPE_TEST_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe key not configured' });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2020-08-27'
    });    
    
    // Create or retrieve a Stripe Connected Account for this barber
    let account;

    try {
      const accounts = await stripe.accounts.list({ limit: 100 });
      account = accounts.data.find((acc) => acc.metadata?.barberId === barberId);

      if (account) {
        console.log('Found existing account:', account.id);
      } else {
        account = await stripe.accounts.create({
          type: 'express',
          metadata: {
            barberId,
            userEmail: email,
            appEnvironment: process.env.NODE_ENV || 'development'
          },
          business_profile: {
            name: name || 'Barber Business',
            product_description: 'Barber Services',
            support_email: email
          },
          business_type: 'individual',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true }
          }
        });
        console.log('Created new account:', account.id);
      }
    } catch (error) {
      console.error('Error creating/retrieving Stripe account:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Base URL for web redirects
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'https://barber-backend.vercel.app';
    
    // Create URLs for redirecting back to the app via our redirect endpoint
    const webReturnUrl = `${baseUrl}/api/stripe-redirect?destination=${encodeURIComponent(returnUrl)}`;
    const webRefreshUrl = `${baseUrl}/api/stripe-redirect?destination=${encodeURIComponent(refreshUrl)}`;
    
    console.log('Web Return URL:', webReturnUrl);
    console.log('Web Refresh URL:', webRefreshUrl);
    
    // Create the account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: webRefreshUrl,
      return_url: webReturnUrl,
      type: 'account_onboarding',
    });
    
    // Return the URL to redirect the user to
    return res.status(200).json({
      url: accountLink.url,
      accountId: account.id
    });
    
  } catch (error) {
    console.error('Error creating account link:', error);
    return res.status(500).json({ error: error.message });
  }
}