// api/create-subscription.js
import Stripe from 'stripe';
import { verifyAuthToken } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Subscription API is running', 
      timestamp: new Date().toISOString(),
      stripe_configured: !!process.env.STRIPE_TEST_SECRET_KEY
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Request body:', req.body);
    
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
    
    if (!stripeKey) {
      console.error('Stripe key not configured');
      return res.status(500).json({ error: 'Stripe key not configured' });
    }
    
    const stripe = new Stripe(stripeKey);
    
    const { userId, priceId, customerEmail, metadata } = req.body;

    if (!userId) {
      console.error('Missing required parameter: userId');
      return res.status(400).json({ error: 'Missing required parameter: userId' });
    }

    if (!customerEmail) {
      console.error('Missing required parameter: customerEmail');
      return res.status(400).json({ error: 'Missing required parameter: customerEmail' });
    }

    const subscriptionPriceId = priceId || 'price_1RvYTZ5qb1EkwiNr5xBt0AgM';
    
    console.log(`Creating subscription for user ${userId} (${customerEmail}) with price ${subscriptionPriceId}`);
    
    let customer;
    
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      console.log(`Found existing customer: ${customer.id}`);
      
      if (customer.metadata.userId !== userId) {
        await stripe.customers.update(customer.id, {
          metadata: { userId }
        });
      }
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
        metadata: {
          userId: userId,
          ...metadata
        }
      });
      console.log(`Created new customer: ${customer.id}`);
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-11-20.acacia' }
    );
    console.log(`Created ephemeral key: ${ephemeralKey.id}`);

    console.log('Creating subscription...');
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: subscriptionPriceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card']
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: userId,
        ...metadata
      },
    });

    console.log(`Subscription created: ${subscription.id}`);

    return res.status(200).json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      status: subscription.status,
      invoice: {
        id: subscription.latest_invoice.id,
        amount: subscription.latest_invoice.amount_due
      }
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ 
      error: error.message,
      type: error.type || 'unknown_error'
    });
  }
}