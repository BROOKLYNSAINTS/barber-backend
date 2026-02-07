import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    console.log('🔍 Checking Stripe account status for user:', userId);

    // Get the barber's Stripe account ID from your database
    const stripeAccountId = await getBarberStripeAccountId(userId);

    if (!stripeAccountId) {
      console.log('⚠️ No Stripe account found for user');
      return res.status(200).json({ status: 'pending' });
    }

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(stripeAccountId);

    const isComplete = account.charges_enabled && account.payouts_enabled;
    
    console.log('✅ Account status retrieved:', {
      accountId: stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      isComplete
    });

    return res.status(200).json({
      status: isComplete ? 'complete' : 'pending',
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      accountId: stripeAccountId,
    });

  } catch (error) {
    console.error('❌ Error checking account status:', error);
    return res.status(500).json({ 
      error: 'Failed to check account status',
      details: error.message 
    });
  }
}

// Helper function to get Stripe account ID from database
async function getBarberStripeAccountId(userId) {
  try {
    // For now, return null since we need to implement database lookup
    // TODO: Implement database lookup
    // Example for Firestore:
    // const admin = require('firebase-admin');
    // const userDoc = await admin.firestore().collection('users').doc(userId).get();
    // return userDoc.data()?.stripeAccountId;
    
    console.log('⚠️ Database lookup not implemented yet');
    return null;
  } catch (error) {
    console.error('❌ Error getting Stripe account ID:', error);
    return null;
  }
}