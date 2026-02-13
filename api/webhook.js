import Stripe from "stripe";
import admin from "firebase-admin";
import { buffer } from "micro";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

// Firebase Admin init
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      /**
       * ----------------------------------
       * SetupIntent succeeded
       * Save card for no-show protection
       * ----------------------------------
       */
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object;

        const stripeCustomerId = setupIntent.customer;
        const paymentMethodId = setupIntent.payment_method;

        console.log("✅ setup_intent.succeeded", {
          stripeCustomerId,
          paymentMethodId,
        });

        if (!stripeCustomerId || !paymentMethodId) {
          console.warn("⚠️ Missing customer or payment method");
          break;
        }

        /**
         * 🔐 Ensure payment method is attached
         */
        try {
          await stripe.paymentMethods.attach(paymentMethodId, {
            customer: stripeCustomerId,
          });
        } catch (err) {
          // Ignore "already attached" errors
          const msg = String(err?.message || "");
          if (!msg.toLowerCase().includes("already")) {
            throw err;
          }
        }

        /**
         * ⭐ Set default payment method
         */
        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });

        /**
         * 🔎 Find user by stripeCustomerId
         */
        const userSnap = await db
          .collection("users")
          .where("stripeCustomerId", "==", stripeCustomerId)
          .limit(1)
          .get();

        if (userSnap.empty) {
          console.warn(
            "⚠️ No user found for stripeCustomerId:",
            stripeCustomerId
          );
          break;
        }

        const userDoc = userSnap.docs[0];

        /**
         * 💾 Persist on user
         */
        await userDoc.ref.update({
          defaultPaymentMethodId: paymentMethodId,
          paymentMethodUpdatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          "💳 Default payment method saved for user:",
          userDoc.id
        );
        break;
      }

      /**
       * Existing handlers
       */
      case "payment_intent.succeeded":
        console.log("✅ Payment succeeded:", event.data.object.id);
        break;

      case "payment_intent.payment_failed":
        console.log("❌ Payment failed:", event.data.object.id);
        break;

      default:
        console.log("Unhandled event type:", event.type);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Webhook processing error:", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
