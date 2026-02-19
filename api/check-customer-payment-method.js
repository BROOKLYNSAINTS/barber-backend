// api/check-customer-payment-method.js

import Stripe from 'stripe';
import { verifyAuthToken } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const decoded = await verifyAuthToken(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }

    console.log('🔍 Checking payment method for customer:', customerId);

    const customer = await stripe.customers.retrieve(customerId);

    const defaultPaymentMethodId =
      customer.invoice_settings?.default_payment_method || null;

    return res.status(200).json({
      customerId: customer.id,
      defaultPaymentMethodId,
    });

  } catch (error) {
    console.error('❌ Error checking payment method:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
