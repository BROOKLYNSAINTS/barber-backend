import Stripe from "stripe";
import { getAdminDb } from "./_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ FIX: db must be inside handler
    const db = getAdminDb(req.headers.host);

    const { appointmentId } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: "Missing appointmentId" });
    }

    const apptRef = db.collection("appointments").doc(appointmentId);
    const apptSnap = await apptRef.get();

    if (!apptSnap.exists) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = apptSnap.data();

    if (!appointment.customerStripeId) {
      return res.status(400).json({ error: "Missing Stripe customer" });
    }

    if (!appointment.barberStripeAccountId) {
      return res.status(400).json({ error: "Barber not connected" });
    }

    const amountCents = Math.round(
      Number(appointment.servicePrice || 0) * 100
    );

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // ✅ CARD ONLY — LINK DISABLED
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: appointment.customerStripeId,

      payment_method_types: ["card"],

      transfer_data: {
        destination: appointment.barberStripeAccountId,
      },

      metadata: {
        appointmentId,
        barberId: appointment.barberId || "",
      },
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: appointment.customerStripeId },
      { apiVersion: "2023-10-16" }
    );

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId: appointment.customerStripeId, // ✅ FIXED NAME
      paymentIntentId: paymentIntent.id,
    });

  } catch (err) {
    console.error("❌ CREATE PAYMENT INTENT (ALT) ERROR:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
