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

  try {
    /* ===========================================
       HAIRCUT & TIP PAYMENTS
    =========================================== */
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
      } else {
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
    }

    /* ===========================================
       SUBSCRIPTION EVENTS (REVENUE PROTECTION)
       IMPORTANT: Your schema stores stripeCustomerId at TOP LEVEL
    =========================================== */

    const isSubscriptionEvent =
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted";

    if (isSubscriptionEvent) {
      const obj = event.data.object;

      // invoice.* events => obj is an invoice
      // subscription.* events => obj is a subscription
      const customerId = obj.customer;

      if (!customerId) {
        console.warn("No customer ID found in subscription event");
      } else {
        // ✅ FIXED QUERY: stripeCustomerId is top-level
        const snapshot = await adminDb
          .collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          console.warn("No user found for customer:", customerId);
        } else {
          const userDoc = snapshot.docs[0];

          let newStatus = null;
          let currentPeriodEndUnix = null; // seconds
          let subscriptionId = null;

          if (event.type === "invoice.payment_failed") {
            // invoice failed usually implies subscription is past_due/unpaid
            newStatus = "past_due";

            // invoice has subscription id sometimes
            if (obj.subscription) subscriptionId = obj.subscription;
          }

          if (event.type === "invoice.payment_succeeded") {
            // invoice paid usually means active (unless trialing etc.)
            newStatus = "active";

            if (obj.subscription) subscriptionId = obj.subscription;
          }

          if (event.type === "customer.subscription.deleted") {
            newStatus = "canceled";
            subscriptionId = obj.id;
            currentPeriodEndUnix = obj.current_period_end || null;
          }

          if (event.type === "customer.subscription.updated") {
            newStatus = obj.status; // active, trialing, past_due, canceled, unpaid, incomplete...
            subscriptionId = obj.id;
            currentPeriodEndUnix = obj.current_period_end || null;
          }

          const updatePayload = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (newStatus) {
            updatePayload["subscription.status"] = newStatus;
          }

          if (subscriptionId) {
            updatePayload["subscription.subscriptionId"] = subscriptionId;
          }

          // Prefer current_period_end from subscription events
          if (currentPeriodEndUnix) {
            updatePayload["subscription.currentPeriodEnd"] = new Date(
              currentPeriodEndUnix * 1000
            ).toISOString();
          }

          // If we have something to update, write it
          const hasMeaningfulUpdate =
            updatePayload["subscription.status"] ||
            updatePayload["subscription.subscriptionId"] ||
            updatePayload["subscription.currentPeriodEnd"];

          if (hasMeaningfulUpdate) {
            await userDoc.ref.update(updatePayload);
            console.log("🔐 Subscription updated:", {
              userId: userDoc.id,
              status: newStatus,
              subscriptionId,
            });
          } else {
            console.log("ℹ️ Subscription event received but no update needed:", event.type);
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).send("Webhook handler failed");
  }
}

/* ===========================================
   RAW BODY READER (CRITICAL FOR STRIPE)
=========================================== */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}