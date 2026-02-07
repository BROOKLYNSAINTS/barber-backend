import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customerId, barberStripeAccountId } = req.body;

    console.log('🔍 Checking payment method for customer:', customerId, 'in account:', barberStripeAccountId);

    // Search for customer in the barber's Connect account
    const customers = await stripe.customers.list(
      {
        limit: 1,
        metadata: { appCustomerId: customerId },
      },
      {
        stripeAccount: barberStripeAccountId,
      }
    );

    if (customers.data.length === 0) {
      console.log('ℹ️ Customer not found in barber account');
      return res.status(200).json({ hasPaymentMethod: false });
    }

    const customer = customers.data[0];
    console.log('✅ Customer found:', customer.id);

    // Check if customer has saved payment methods
    const paymentMethods = await stripe.paymentMethods.list(
      {
        customer: customer.id,
        type: 'card',
      },
      {
        stripeAccount: barberStripeAccountId,
      }
    );

    if (paymentMethods.data.length > 0) {
      console.log('✅ Payment method found:', paymentMethods.data[0].id);
      return res.status(200).json({
        hasPaymentMethod: true,
        customerStripeId: customer.id,
        paymentMethodId: paymentMethods.data[0].id,
      });
    }

    console.log('ℹ️ No payment methods found for customer');
    return res.status(200).json({ hasPaymentMethod: false });

  } catch (error) {
    console.error('❌ Error checking payment method:', error);
    return res.status(500).json({ 
      error: 'Failed to check payment method',
      details: error.message 
    });
  }
}