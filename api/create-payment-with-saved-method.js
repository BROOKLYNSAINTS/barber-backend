import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      amount,
      customer_id,
      payment_method_id, // ID of saved payment method
      service_name,
      barber_name,
      appointment_date,
      appointment_time,
      metadata
    } = req.body;

    if (!amount || !customer_id || !payment_method_id) {
      return res.status(400).json({ 
        error: 'amount, customer_id, and payment_method_id are required' 
      });
    }

    const amountInCents = Math.round(amount * 100);

    // Create payment intent with saved payment method
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: customer_id,
      payment_method: payment_method_id,
      confirmation_method: 'automatic',
      confirm: true, // Auto-confirm since we're using saved payment method
      return_url: 'https://your-app.com/return', // Required for confirm=true
      description: `${service_name} with ${barber_name} on ${appointment_date} at ${appointment_time}`,
      metadata: {
        ...metadata,
        serviceName: service_name,
        barberName: barber_name,
        appointmentDate: appointment_date,
        appointmentTime: appointment_time,
      }
    });

    console.log('✅ Payment with saved method - Status:', paymentIntent.status);

    res.status(200).json({
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret // In case 3D Secure is needed
    });

  } catch (error) {
    console.error('❌ Error creating payment with saved method:', error);
    res.status(500).json({ 
      error: error.message,
      type: error.type 
    });
  }
}
