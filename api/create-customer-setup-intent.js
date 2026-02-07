import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customerId, customerName, customerEmail, barberStripeAccountId } = req.body;

    console.log('🔧 Creating customer and setup intent for:', customerId, 'in account:', barberStripeAccountId);

    // Step 1: Create or get customer in barber's Connect account
    let customer;
    
    // First check if customer already exists
    const existingCustomers = await stripe.customers.list(
      {
        limit: 1,
        metadata: { appCustomerId: customerId },
      },
      {
        stripeAccount: barberStripeAccountId,
      }
    );

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      console.log('✅ Using existing customer:', customer.id);
    } else {
      // Create new customer in barber's account
      customer = await stripe.customers.create(
        {
          name: customerName,
          email: customerEmail,
          metadata: {
            appCustomerId: customerId,
          },
        },
        {
          stripeAccount: barberStripeAccountId,
        }
      );
      console.log('✅ Created new customer:', customer.id);
    }

    // Step 2: Create Setup Intent to save payment method
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session', // For future payments
        metadata: {
          appCustomerId: customerId,
          barberStripeAccountId: barberStripeAccountId,
        },
      },
      {
        stripeAccount: barberStripeAccountId,
      }
    );

    console.log('✅ Setup intent created:', setupIntent.id);

    return res.status(200).json({
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      customerStripeId: customer.id,
    });

  } catch (error) {
    console.error('❌ Error creating setup intent:', error);
    return res.status(500).json({ 
      error: 'Failed to create setup intent',
      details: error.message 
    });
  }
}