import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, refreshUrl, returnUrl } = req.body;

    console.log('🔗 Creating onboarding link for user:', userId);

    // Get the barber's Stripe account ID
    let stripeAccountId = await getBarberStripeAccountId(userId);

    // If no account exists, create one
    if (!stripeAccountId) {
      console.log('🆕 Creating new Stripe Express account...');
      
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          userId: userId,
        },
      });

      stripeAccountId = account.id;
      console.log('✅ Created Stripe account:', stripeAccountId);

      // Save the account ID to your database
      await saveBarberStripeAccountId(userId, stripeAccountId);
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl || 'https://yourapp.com/dashboard',
      return_url: returnUrl || 'https://yourapp.com/dashboard?onboarding=complete',
      type: 'account_onboarding',
    });

    console.log('✅ Onboarding link created:', accountLink.url);

    return res.status(200).json({
      url: accountLink.url,
      accountId: stripeAccountId,
    });

  } catch (error) {
    console.error('❌ Error creating onboarding link:', error);
    return res.status(500).json({ 
      error: 'Failed to create onboarding link',
      details: error.message 
    });
  }
}

// Helper functions
async function getBarberStripeAccountId(userId) {
  try {
    // TODO: Replace with your database lookup
    console.log('⚠️ Database lookup not implemented yet for user:', userId);
    return null;
  } catch (error) {
    console.error('❌ Error getting Stripe account ID:', error);
    return null;
  }
}

async function saveBarberStripeAccountId(userId, stripeAccountId) {
  try {
    // TODO: Replace with your database save
    console.log('💾 TODO: Save to database - User:', userId, 'Account:', stripeAccountId);
  } catch (error) {
    console.error('❌ Error saving Stripe account ID:', error);
  }
}