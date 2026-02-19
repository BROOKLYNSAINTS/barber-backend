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
    const user = await verifyAuthToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { stripeCustomerId } = req.body;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'stripeCustomerId required' });
    }

    // Get latest payment method attached to customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
    });

    if (!paymentMethods.data.length) {
      return res.status(400).json({ error: 'No payment methods found' });
    }

    const latestPaymentMethod = paymentMethods.data[0];

    // Set as default
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: latestPaymentMethod.id,
      },
    });

    return res.status(200).json({
      success: true,
      defaultPaymentMethodId: latestPaymentMethod.id,
    });

  } catch (error) {
    console.error('❌ Failed to set default payment method:', error);
    return res.status(500).json({ error: error.message });
  }
}
