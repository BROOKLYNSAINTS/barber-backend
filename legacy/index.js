require('dotenv').config();

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:8081',
    'exp://192.168.1.219:8081',
    'https://your-domain.com'
  ],
  credentials: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'Backend is running',
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------
// CREATE PAYMENT INTENT (CARD ONLY)
// -------------------------------------
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, description, metadata } = req.body;

    console.log('💳 Creating PaymentIntent:', { amount, description, metadata });

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
    }

    // Create customer (you may later reuse instead of recreate)
    const customer = await stripe.customers.create({
      metadata: {
        userId: metadata?.userId || 'unknown',
        appointmentId: metadata?.appointmentId || 'unknown'
      }
    });

    // Create ephemeral key
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2023-10-16' }
    );

    // 🔒 CARD ONLY — LINK DISABLED
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customer.id,
      description: description || 'Barber Service Payment',
      metadata: {
        userId: metadata?.userId || 'unknown',
        barberId: metadata?.barberId || 'unknown',
        appointmentId: metadata?.appointmentId || 'unknown'
      },
      payment_method_types: ['card']
    });

    console.log('✅ PaymentIntent created:', paymentIntent.id);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('❌ Error creating PaymentIntent:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// -------------------------------------
// STRIPE WEBHOOK
// -------------------------------------
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.log('⚠️ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📨 Webhook event:', event.type);

  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('💰 Payment succeeded:', event.data.object.id);
      break;

    case 'payment_intent.payment_failed':
      console.log('❌ Payment failed:', event.data.object.id);
      break;

    default:
      console.log('🤷 Unhandled event type:', event.type);
  }

  res.json({ received: true });
});

// Error handler
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
  console.log(`🚀 Barber backend running on port ${port}`);
  console.log(`💳 Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
  console.log(`🪝 Webhook configured: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Yes' : 'No'}`);
});

module.exports = app;