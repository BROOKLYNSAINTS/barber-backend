// api/create-tip-payment-intent.js

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
    const db = getAdminDb(req.headers.host);

    const { appointmentId, tipAmount, tipAmountCents } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: "Missing appointmentId" });
    }

    const amountCents =
      Number.isFinite(Number(tipAmountCents)) &&
      Number(tipAmountCents) > 0
        ? Math.round(Number(tipAmountCents))
        : Math.round(Number(tipAmount || 0) * 100);

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid tip amount" });
    }

    const apptRef = db
      .collection("appointments")
      .doc(String(appointmentId));

    const apptSnap = await apptRef.get();

    if (!apptSnap.exists) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = apptSnap.data();

    // 🔥 HARD FAIL WITH LOGGING (so we KNOW what is missing)
    if (!appointment.customerStripeId) {
      console.error("❌ Missing customerStripeId on appointment:", appointmentId);
      return res.status(400).json({ error: "Missing Stripe customer" });
    }

    // 🔥 AUTO-FIX barber account if missing (NO MORE FAILURES)
    let barberStripeAccountId = appointment.barberStripeAccountId;

    if (!barberStripeAccountId) {
      console.warn("⚠️ barberStripeAccountId missing — pulling from barber doc");

      const barberRef = db.collection("users").doc(appointment.barberId);
      const barberSnap = await barberRef.get();

      if (!barberSnap.exists) {
        return res.status(400).json({ error: "Barber not found" });
      }

      const barberData = barberSnap.data();
      barberStripeAccountId = barberData?.stripeConnectAccountId || null;

      if (!barberStripeAccountId) {
        return res.status(400).json({ error: "Barber not connected" });
      }

      // ✅ WRITE BACK so future calls are clean
      await apptRef.update({
        barberStripeAccountId,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: appointment.customerStripeId,
      payment_method_types: ["card"],
      transfer_data: {
        destination: barberStripeAccountId,
      },
      metadata: {
        appointmentId: String(appointmentId),
        barberId: appointment.barberId || "",
        paymentCategory: "tip",
      },
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: appointment.customerStripeId },
      { apiVersion: "2023-10-16" }
    );

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId: appointment.customerStripeId,
      paymentIntentId: paymentIntent.id,
      amount: amountCents,
      paymentCategory: "tip",
    });

  } catch (err) {
    console.error("❌ TIP PAYMENT ERROR:", err);

    return res.status(500).json({
      error: err?.message || "Internal server error",
    });
  }
}
