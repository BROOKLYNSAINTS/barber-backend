// api/create-customer-setup-intent.js

import Stripe from 'stripe';
import { getAuthUser } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { customerEmail, customerName } = req.body;

    if (!customerEmail) {
      return res.status(400).json({ error: 'customerEmail required' });
    }

    console.log('🔧 Creating customer + SetupIntent (platform level)');

    // 1️⃣ Find or create Stripe customer (PLATFORM)
    let customer;

    const existing = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName || 'Customer',
      });
    }

    // 2️⃣ Create ephemeral key (PLATFORM)
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2023-10-16' }
    );

    // 3️⃣ Create SetupIntent (PLATFORM — NO CONNECT)
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
    });

    return res.status(200).json({
      setupIntentClientSecret: setupIntent.client_secret,
      customer: customer.id,
      ephemeralKey: ephemeralKey.secret,
    });

  } catch (error) {
    console.error('❌ Error creating setup intent:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
