const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Barber Backend Server is running!' });
});

// -----------------------------
// CREATE PAYMENT INTENT (CARD ONLY)
// -----------------------------
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, description, metadata } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'Amount is required',
      });
    }

    console.log('Creating payment intent for amount:', amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert dollars to cents
      currency: 'usd',
      description: description || 'Barber Service',
      metadata: metadata || {},

      // 🔒 CARD ONLY — DISABLE LINK & AUTO METHODS
      payment_method_types: ['card'],
    });

    console.log('Payment intent created successfully:', paymentIntent.id);

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// -----------------------------
// WEBHOOK ENDPOINT
// -----------------------------
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
      console.log('✅ Webhook verified:', event.type);
    } catch (err) {
      console.log(
        `⚠️ Webhook signature verification failed.`,
        err.message
      );
      return res
        .status(400)
        .send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        console.log('💳 Payment succeeded:', paymentIntent.id);
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        console.log('❌ Payment failed:', failedPayment.id);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  }
);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📍 Health check: http://localhost:${port}`);
  console.log(
    `💳 Payment endpoint: http://localhost:${port}/create-payment-intent`
  );
  console.log(
    `🎣 Webhook endpoint: http://localhost:${port}/webhook`
  );
});