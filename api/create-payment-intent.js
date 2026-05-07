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

    const { appointmentId, amount, type } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: "Missing appointmentId" });
    }

    const apptRef = db.collection("appointments").doc(appointmentId);
    const apptSnap = await apptRef.get();

    if (!apptSnap.exists) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = apptSnap.data();

    // 🔥 NEW: USE STORED barberStripeAccountId FIRST (fallback if missing)
    const barberStripeAccountId =
      appointment.barberStripeAccountId ||
      (await db.collection("users")
        .doc(appointment.barberId)
        .get())
        .data()?.stripeConnectAccountId;

    // CUSTOMER
    const customerRef = db.collection("users").doc(appointment.customerId);
    const customerSnap = await customerRef.get();
    const customerData = customerSnap.data();

    const stripeCustomerId = customerData?.stripeCustomerId;
    const defaultPaymentMethodId = customerData?.defaultPaymentMethodId;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: "Missing Stripe customer" });
    }

    if (!barberStripeAccountId) {
      return res.status(400).json({ error: "Barber not connected" });
    }

    // AMOUNT
    let amountToCharge =
      type === "tip"
        ? Number(amount)
        : Number(appointment.servicePrice || 0);

    const amountCents = Math.round(amountToCharge * 100);

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // =========================
    // 🔥 TIP FLOW (AUTO CHARGE)
    // =========================
    if (type === "tip") {
      if (!defaultPaymentMethodId || defaultPaymentMethodId === "ok") {
        return res.status(400).json({
          error: "Missing real default payment method",
        });
      }

      let paymentIntent;

      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: stripeCustomerId,
          payment_method: defaultPaymentMethodId,
          confirm: true,
          off_session: true,

          transfer_data: {
            destination: barberStripeAccountId,
          },

          metadata: {
            appointmentId,
            type: "tip",
          },
        });
      } catch (err) {
        return res.status(400).json({
          error: err?.message || "Charge failed",
        });
      }

      return res.status(200).json({
        paymentIntentId: paymentIntent.id,
      });
    }

    // =========================
    // 🔥 SERVICE FLOW (PAYMENTSHEET)
    // =========================
    let paymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomerId,

        setup_future_usage: "off_session",

        automatic_payment_methods: { enabled: true },

        transfer_data: {
          destination: barberStripeAccountId,
        },

        metadata: {
          appointmentId,
          type: "service",
        },
      });
    } catch (err) {
      return res.status(400).json({
        error: err?.message || "Charge failed",
      });
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: "2023-10-16" }
    );

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId: stripeCustomerId,
      paymentIntentId: paymentIntent.id,
    });

  } catch (err) {
    console.error("create-payment-intent error:", err);
    return res.status(500).json({
      error: err?.message || "Internal server error",
    });
  }
}
