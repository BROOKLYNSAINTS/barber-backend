const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { paymentIntentId, amount, appointmentId, reason } = req.body;

    // Validate required fields
    if (!paymentIntentId || !amount || !appointmentId) {
      return res.status(400).json({ 
        error: 'Missing required fields: paymentIntentId, amount, appointmentId' 
      });
    }

    console.log('💰 Processing refund:', {
      paymentIntentId,
      amount,
      appointmentId,
      reason: reason || 'Appointment cancelled'
    });

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount, // Amount in cents
      metadata: {
        appointmentId: appointmentId,
        reason: reason || 'Appointment cancelled by barber',
        processedAt: new Date().toISOString()
      }
    });

    console.log('✅ Stripe refund created:', refund.id);

    // Return success response
    res.status(200).json({
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      metadata: refund.metadata,
      created: refund.created
    });

  } catch (error) {
    console.error('❌ Stripe refund error:', error);

    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ 
        error: 'Card error: ' + error.message,
        type: error.type 
      });
    } else if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ 
        error: 'Invalid request: ' + error.message,
        type: error.type 
      });
    } else if (error.type === 'StripeAPIError') {
      return res.status(500).json({ 
        error: 'Stripe API error: ' + error.message,
        type: error.type 
      });
    }

    // Generic error
    res.status(500).json({ 
      error: error.message || 'Failed to process refund',
      type: error.type || 'unknown_error'
    });
  }
}