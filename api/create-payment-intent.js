import Stripe from 'stripe';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  
  try {
    console.log('Request body received:', req.body);
    
    // Use STRIPE_TEST_SECRET_KEY from environment
    const stripeKey = process.env.STRIPE_TEST_SECRET_KEY;
    
    console.log('Stripe key defined?', !!stripeKey);
    
    if (!stripeKey) {
      console.error('Stripe key is undefined');
      return res.status(500).json({ error: 'Stripe key is not configured' });
    }
    
    const stripe = new Stripe(stripeKey);
    
    // Extract parameters safely
    const amount = req.body?.amount || 0;
    const customer_email = req.body?.customer_email;
    const customer_id = req.body?.customer_id;
    const metadata = req.body?.metadata || {};
    const currency = req.body?.currency || 'usd';
    
    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    
    // Get or create customer
    let customer = customer_id;
    if (customer_email) {
      try {
        const customers = await stripe.customers.list({
          email: customer_email,
          limit: 1
        });
        customer = customers.data.length > 0 
          ? customers.data[0].id
          : (await stripe.customers.create({ email: customer_email })).id;
      } catch (customerError) {
        console.error('Customer error:', customerError);
        return res.status(400).json({ error: `Customer error: ${customerError.message}` });
      }
    }
    
    // Check if we need to transfer to a barber (Stripe Connect)
    let paymentIntent;
    const amountInCents = Math.round(amount * 100);
    
    // Get barber ID from the metadata
    const barberId = metadata?.barberId;
    
    if (barberId) {
      console.log(`Found barberId ${barberId} in metadata, checking for Stripe account`);
      
      try {
        // Get barber's document from Firestore
        const barberRef = db.collection('users').doc(barberId);
        const barberDoc = await barberRef.get();
        
        if (!barberDoc.exists) {
          console.log(`No barber found with ID ${barberId}`);
          throw new Error('Barber not found');
        }
        
        const barberData = barberDoc.data();
        const stripeAccountId = barberData.stripeAccountId;
        
        if (stripeAccountId) {
          console.log(`Creating payment with transfer to barber account: ${stripeAccountId}`);
          
          // Calculate platform fee (20% of amount)
          const platformFeePercentage = 0.2; // 20%
          const platformFee = Math.round(amountInCents * platformFeePercentage);
          const transferAmount = amountInCents - platformFee;
          
          console.log(`Amount: ${amountInCents}, Platform Fee: ${platformFee}, Transfer Amount: ${transferAmount}`);
          
          // Create payment intent with transfer to barber's account
          paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency,
            customer,
            metadata,
            transfer_data: {
              destination: stripeAccountId,
              amount: transferAmount, // Amount minus platform fee
            },
            application_fee_amount: platformFee, // Platform fee
          });
          
          console.log('Created payment intent with Stripe Connect transfer');
        } else {
          console.log(`No Stripe account found for barber ${barberId}, processing standard payment`);
          // Fall back to regular payment intent if no Connect account
          paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency,
            customer,
            metadata
          });
        }
      } catch (error) {
        console.error('Error setting up Connect transfer:', error);
        // Fall back to regular payment intent if there's an error
        paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency,
          customer,
          metadata
        });
      }
    } else {
      // Regular payment intent (no Connect)
      console.log('No barberId in metadata, creating standard payment intent');
      
      // Create customer if not provided
      if (!customer) {
        const newCustomer = await stripe.customers.create({ metadata });
        customer = newCustomer.id;
      }
      
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency,
        customer,
        metadata
      });
    }
    
    // Create ephemeral key
    let ephemeralKey;
    try {
      ephemeralKey = await stripe.ephemeralKeys.create(
        { customer },
        { apiVersion: '2022-11-15'} // Use a supported API version
      );
    } catch (keyError) {
      console.error('Ephemeral key error:', keyError);
      return res.status(400).json({ error: `Ephemeral key error: ${keyError.message}` });
    }
    
    // Return the successful response
    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer,
      paymentIntentId: paymentIntent.id
    });
    
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return res.status(500).json({ error: error.message });
  }
}
