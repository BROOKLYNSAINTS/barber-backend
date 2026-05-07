import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      amount,
      currency = 'usd',
      customer_id,
      appointmentId,
      appointment_id,
      customer_email,
      customer_name,
      service_name,
      barber_name,
      appointment_date,
      appointment_time,
      metadata
    } = req.body;

    const resolvedAppointmentId = String(
      appointmentId || appointment_id || metadata?.appointmentId || metadata?.appointment_id || ""
    ).trim();

    if (!amount) {
      return res.status(400).json({ success: false, error: 'Amount is required' });
    }

    if (!customer_id) {
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ success: false, error: 'Stripe not configured' });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer_id,
      type: 'card',
    });

    if (paymentMethods.data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No saved payment methods found for customer'
      });
    }

    const paymentMethod = paymentMethods.data[0];

    // 🔥 KEY FIX — DO NOT CONFIRM HERE
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer_id,
      payment_method: paymentMethod.id,
      description: `${service_name} with ${barber_name} on ${appointment_date} at ${appointment_time}`,
      metadata: {
        ...metadata,
        ...(resolvedAppointmentId
          ? {
              appointmentId: resolvedAppointmentId,
              appointment_id: resolvedAppointmentId,
            }
          : {}),
        customerName: customer_name,
        customerEmail: customer_email,
        paymentType: 'existing_customer',
        serviceName: service_name,
        barberName: barber_name,
        appointmentDate: appointment_date,
        appointmentTime: appointment_time,
      },
      receipt_email: customer_email,
      confirmation_method: 'automatic',
    });

    // 🔥 RETURN CLIENT SECRET FOR FRONTEND 3DS
    return res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId: customer_id,
      paymentMethodId: paymentMethod.id,
    });

  } catch (error) {
    console.error('❌ Payment error:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}