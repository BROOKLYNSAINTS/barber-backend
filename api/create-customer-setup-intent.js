// api/create-customer-setup-intent.js

import Stripe from "stripe";
import { verifyAuthToken } from "./_auth.js";
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
    const user = await verifyAuthToken(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const uid = user.uid;
    const { customerEmail, customerName } = req.body;

    if (!customerEmail) {
      return res.status(400).json({ error: "customerEmail required" });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    let stripeCustomerId = userSnap.exists
      ? userSnap.data()?.stripeCustomerId || null
      : null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName || "Customer",
      });

      stripeCustomerId = customer.id;

      await userRef.set(
        {
          stripeCustomerId,
        },
        { merge: true }
      );
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: "2023-10-16" }
    );

    return res.status(200).json({
      setupIntentClientSecret: setupIntent.client_secret,
      customer: stripeCustomerId,
      ephemeralKey: ephemeralKey.secret,
    });

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Internal server error",
    });
  }
}
