import Stripe from "stripe";
import admin from "firebase-admin";
import { adminDb } from "./_firebaseAdmin.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("Webhook secret missing in environment");
    return res.status(500).send("Webhook secret not configured");
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    const appointmentId = paymentIntent.metadata?.appointmentId;
    const paymentCategory =
      paymentIntent.metadata?.paymentCategory || "service";

    if (!appointmentId) {
      console.warn(
        "payment_intent.succeeded missing appointmentId:",
        paymentIntent.id
      );
      return res.status(200).json({ received: true, skipped: true });
    }

    if (paymentCategory === "tip") {
      await adminDb.collection("appointments").doc(appointmentId).update({
        tipStatus: "paid",
        tipPaidAt: admin.firestore.FieldValue.serverTimestamp(),
        tipAmountPaid: admin.firestore.FieldValue.increment(
          paymentIntent.amount / 100
        ),
        tipPaymentIntentId: paymentIntent.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ Appointment tip updated:", appointmentId);
    } else {
      await adminDb.collection("appointments").doc(appointmentId).update({
        paymentStatus: "paid",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        amountPaid: paymentIntent.amount / 100,
        paymentIntentId: paymentIntent.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ Appointment payment updated:", appointmentId);
    }
  }

  res.status(200).json({ received: true });
}

/* ===========================================
   RAW BODY READER (CRITICAL PART)
=========================================== */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
