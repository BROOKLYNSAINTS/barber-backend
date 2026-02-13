import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customerId, barberStripeAccountId } = req.body;
    const normalizedAccountId =
      typeof barberStripeAccountId === 'string' ? barberStripeAccountId.trim() : '';

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    if (!normalizedAccountId) {
      return res.status(400).json({ error: 'barberStripeAccountId is required' });
    }
    if (!normalizedAccountId.startsWith('acct_')) {
      return res.status(400).json({ error: 'Invalid barberStripeAccountId' });
    }

    console.log('🔍 Checking payment method for customer:', customerId, 'in account:', normalizedAccountId);

    let customer = null;

    // If a Stripe customer id is provided, retrieve directly.
    if (typeof customerId === 'string' && customerId.startsWith('cus_')) {
      try {
        customer = await stripe.customers.retrieve(
          customerId,
          {},
          { stripeAccount: normalizedAccountId }
        );
      } catch (error) {
        const missingCustomer =
          error?.type === 'StripeInvalidRequestError' && error?.code === 'resource_missing';
        if (!missingCustomer) {
          throw error;
        }
      }
    }

    // Otherwise list and filter metadata client-side.
    if (!customer) {
      const customers = await stripe.customers.list(
        {
          limit: 100,
        },
        {
          stripeAccount: normalizedAccountId,
        }
      );
      customer = customers.data.find((c) => c.metadata?.appCustomerId === customerId) || null;
    }

    if (!customer || customer.deleted) {
      console.log('ℹ️ Customer not found in barber account');
      return res.status(200).json({ hasPaymentMethod: false });
    }

    console.log('✅ Customer found:', customer.id);

    // Check if customer has saved payment methods
    const paymentMethods = await stripe.paymentMethods.list(
      {
        customer: customer.id,
        type: 'card',
      },
      {
        stripeAccount: normalizedAccountId,
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
