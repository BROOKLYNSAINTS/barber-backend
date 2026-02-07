import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // ✅ Enhanced CORS Headers for consistency across endpoints
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  
  console.log('🔍 API called with method:', req.method);
  console.log('🔍 Request body:', JSON.stringify(req.body, null, 2));

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      amount,
      currency = 'usd',
      customer_id,
      customer_email,
      customer_name,
      service_name,
      barber_name,
      appointment_date,
      appointment_time,
      metadata
    } = req.body;

    // ✅ Validate required fields
    if (!amount) {
      console.error('❌ Missing amount');
      return res.status(400).json({ success: false, error: 'Amount is required' });
    }

    if (!customer_id) {
      console.error('❌ Missing customer_id');
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    console.log('💳 Processing payment for existing customer:', customer_id);
    console.log('💳 Payment amount:', amount, 'cents');

    // ✅ Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ Stripe secret key not configured');
      return res.status(500).json({ success: false, error: 'Stripe not configured' });
    }

    // ✅ Get the customer's saved payment methods
    console.log('🔍 Fetching payment methods for customer:', customer_id);
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer_id,
      type: 'card',
    });

    console.log('💳 Found', paymentMethods.data.length, 'saved payment methods');

    if (paymentMethods.data.length === 0) {
      console.log('❌ No saved payment methods found for customer:', customer_id);
      return res.status(400).json({ 
        success: false,
        error: 'No saved payment methods found for customer' 
      });
    }

    // ✅ Use the first (most recent) payment method
    const paymentMethod = paymentMethods.data[0];
    console.log('💳 Using saved payment method:', paymentMethod.id);
    console.log('💳 Card ending in:', paymentMethod.card.last4);

    // ✅ Create and confirm payment intent
    console.log('🔄 Creating payment intent...');
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer_id,
      payment_method: paymentMethod.id,
      description: `${service_name} with ${barber_name} on ${appointment_date} at ${appointment_time}`,
      metadata: {
        ...metadata,
        customerName: customer_name,
        customerEmail: customer_email,
        paymentType: 'existing_customer',
        serviceName: service_name,
        barberName: barber_name,
        appointmentDate: appointment_date,
        appointmentTime: appointment_time,
      },
      receipt_email: customer_email,
      confirm: true, // ← Automatically confirm the payment
      return_url: 'https://yourapp.com/payment-return',
    });

    console.log('✅ Payment processed for existing customer:', paymentIntent.id);
    console.log('💳 Payment status:', paymentIntent.status);
    console.log('💳 Amount charged:', (amount / 100), 'USD');

    if (paymentIntent.status === 'succeeded') {
      return res.json({
        success: true,
        paymentIntentId: paymentIntent.id,
        customerId: customer_id,
        paymentMethodId: paymentMethod.id,
        status: paymentIntent.status,
        amount: amount,
        last4: paymentMethod.card.last4,
        brand: paymentMethod.card.brand,
      });
    } else {
      console.log('❌ Payment failed with status:', paymentIntent.status);
      return res.status(400).json({
        success: false,
        error: 'Payment failed',
        status: paymentIntent.status,
        details: 'Payment could not be processed'
      });
    }

  } catch (error) {
    console.error('❌ Detailed error in payment processing:');
    console.error('- Error type:', error.constructor.name);
    console.error('- Error message:', error.message);
    console.error('- Error code:', error.code);
    console.error('- Error stack:', error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process payment for existing customer',
      details: error.message,
      errorType: error.constructor.name
    });
  }
}