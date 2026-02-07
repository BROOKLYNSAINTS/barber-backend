// api/create-customer.js
import Stripe from 'stripe';

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
    const { email, name, userId } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Missing email parameter' });
    }
    
    const stripeKey = process.env.STRIPE_TEST_SECRET_KEY;
    
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe key not configured' });
    }
    
    const stripe = new Stripe(stripeKey);
    
    // Check if customer already exists
    const customers = await stripe.customers.list({
      email: email,
      limit: 1
    });
    
    let customer;
    
    if (customers.data.length > 0) {
      // Customer exists, use that one
      customer = customers.data[0];
      console.log(`Found existing Stripe customer: ${customer.id}`);
    } else {
      // Create new customer
      customer = await stripe.customers.create({
        email: email,
        name: name,
        metadata: {
          userId: userId
        }
      });
      console.log(`Created new Stripe customer: ${customer.id}`);
    }
    
    return res.status(200).json({
      customerId: customer.id
    });
  } catch (error) {
    console.error('Error creating/finding customer:', error);
    return res.status(500).json({ error: error.message });
  }
}