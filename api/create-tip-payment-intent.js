// api/create-tip-payment-intent.js

import Stripe from "stripe";
import { adminDb } from "./_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const db = adminDb;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
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

    if (!appointment.customerStripeId) {
      return res
        .status(400)
        .json({ error: "Missing Stripe customer" });
    }

    if (!appointment.barberStripeAccountId) {
      return res
        .status(400)
        .json({ error: "Barber not connected" });
    }

    const paymentIntent =
      await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: appointment.customerStripeId,
        automatic_payment_methods: {
          enabled: true,
        },
        transfer_data: {
          destination:
            appointment.barberStripeAccountId,
        },
        metadata: {
          appointmentId: String(
            appointmentId
          ),
          barberId:
            appointment.barberId || "",
          paymentCategory: "tip",
        },
      });

    const ephemeralKey =
      await stripe.ephemeralKeys.create(
        { customer: appointment.customerStripeId },
        { apiVersion: "2023-10-16" }
      );

    return res.status(200).json({
      clientSecret:
        paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer:
        appointment.customerStripeId,
      paymentIntentId: paymentIntent.id,
      amount: amountCents,
      paymentCategory: "tip",
    });

  } catch (err) {
    return res.status(500).json({
      error: err?.message,
    });
  }
}
