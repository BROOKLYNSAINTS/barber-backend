// api/debug-stripe.js
import Stripe from 'stripe';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  try {
    // Get the Stripe key
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe key not configured' });
    }
    
    // Initialize Stripe with the key
    const stripe = new Stripe(stripeKey);
    
    // Get Stripe library version
    const stripeVersion = stripe.VERSION;
    
    return res.status(200).json({
      stripeLibraryVersion: stripeVersion,
      recommendedApiVersion: stripeVersion,
      message: 'Use this version in your ephemeral key creation'
    });
  } catch (error) {
    console.error('Error debugging Stripe:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack
    });
  }
}