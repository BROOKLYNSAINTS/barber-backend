require('dotenv').config();

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:8081', 'exp://192.168.1.219:8081', 'https://your-domain.com'],
  credentials: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running', timestamp: new Date().toISOString() });
});

// Create PaymentIntent endpoint
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, description, metadata } = req.body;
    
    console.log('💳 Creating PaymentIntent:', { amount, description, metadata });
    
    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid amount' 
      });
    }
    
    // Create or retrieve customer
    let customer;
    try {
      // In production, you might want to store customer IDs in your database
      // For now, we'll create a new customer each time
      customer = await stripe.customers.create({
        metadata: {
          userId: metadata?.userId || 'unknown',
          appointmentId: metadata?.appointmentId || 'unknown'
        }
      });
    } catch (customerError) {
      console.error('Error creating customer:', customerError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create customer' 
      });
    }
    
    // Create ephemeral key for customer
    let ephemeralKey;
    try {
      ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customer.id },
        { apiVersion: '2023-10-16' }
      );
    } catch (keyError) {
      console.error('Error creating ephemeral key:', keyError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create ephemeral key' 
      });
    }
    
    // Create PaymentIntent
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: customer.id,
        description: description || 'Barber Service Payment',
        metadata: {
          userId: metadata?.userId || 'unknown',
          barberId: metadata?.barberId || 'unknown',
          appointmentId: metadata?.appointmentId || 'unknown'
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (paymentError) {
      console.error('Error creating payment intent:', paymentError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create payment intent' 
      });
    }
    
    console.log('✅ PaymentIntent created successfully:', paymentIntent.id);
    
    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      paymentIntentId: paymentIntent.id
    });
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
});

// Webhook endpoint to handle Stripe events
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.log(`⚠️ Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  console.log('📨 Received webhook event:', event.type);
  
  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('💰 PaymentIntent succeeded:', paymentIntent.id);
      
      // Here you could update your Firestore database
      // to confirm the payment on the server side
      // const { userId, appointmentId } = paymentIntent.metadata;
      // await updateAppointmentPaymentStatus(appointmentId, 'paid');
      
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ PaymentIntent failed:', failedPayment.id);
      
      // Handle failed payment
      // const { userId, appointmentId } = failedPayment.metadata;
      // await updateAppointmentPaymentStatus(appointmentId, 'failed');
      
      break;
      
    default:
      console.log(`🤷 Unhandled event type: ${event.type}`);
  }
  
  res.json({ received: true });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint not found' 
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`🚀 Barber backend server running on port ${port}`);
  console.log(`💳 Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
  console.log(`🪝 Webhook configured: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Yes' : 'No'}`);
});

module.exports = app;
