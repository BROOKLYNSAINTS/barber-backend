import Stripe from "stripe";
import { getAdminDb } from "./_firebaseAdmin.js";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ FIX: move db inside handler
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
    const ns = appointment.noShowProtection || {};

    if (!ns.enabled) {
      return res.status(400).json({ error: "No-show protection not enabled" });
    }

    if (ns.status === "charged") {
      return res.status(200).json({ success: true, message: "Already charged" });
    }

    if (
      !appointment.customerStripeId ||
      !appointment.customerStripePaymentMethodId ||
      !appointment.barberStripeAccountId
    ) {
      return res.status(400).json({
        error: "Missing Stripe linkage on appointment",
      });
    }

    const amountCents = Number(ns.amountCents || 0);

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid no-show amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: appointment.customerStripeId,
      payment_method: appointment.customerStripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: "Late cancellation / No-show fee",
      transfer_data: {
        destination: appointment.barberStripeAccountId,
      },
      metadata: {
        appointmentId,
        barberId: appointment.barberId,
        customerId: appointment.customerId,
      },
    });

    await apptRef.update({
      "noShowProtection.status": "charged",
      "noShowProtection.paymentIntentId": paymentIntent.id,
      "noShowProtection.chargedAt":
        admin.firestore.FieldValue.serverTimestamp(),
      paymentStatus: "late_fee_paid",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      paymentIntentId: paymentIntent.id,
      amountCharged: amountCents / 100,
    });
  } catch (err) {
    console.error("❌ NO SHOW CHARGE ERROR:", err);

    return res.status(500).json({
      error: "Failed to charge no-show",
      details: err.message,
    });
  }
}
