// api/create-subscription.js

import Stripe from "stripe";
import admin from "firebase-admin";
import { verifyAuthToken } from "./_auth.js";
import { adminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "Subscription API is running",
      timestamp: new Date().toISOString(),
      stripe_configured: !!process.env.STRIPE_SECRET_KEY,
      firestore_configured: !!adminDb,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    const { userId, priceId, customerEmail, metadata } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing required parameter: userId" });
    }

    // ✅ Security: only allow creating subscription for the authenticated user
    if (user.uid && user.uid !== userId) {
      return res.status(403).json({ error: "Forbidden: userId mismatch" });
    }

    if (!customerEmail) {
      return res.status(400).json({ error: "Missing required parameter: customerEmail" });
    }

    const subscriptionPriceId =
      priceId || process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

    let customer;

    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];

      if (customer.metadata?.userId !== userId) {
        await stripe.customers.update(customer.id, {
          metadata: { userId },
        });
      }
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
        metadata: {
          userId,
          ...(metadata || {}),
        },
      });
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2023-10-16" }
    );

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: subscriptionPriceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        userId,
        ...(metadata || {}),
      },
    });

    // ✅ BEST FIX: write subscription into Firestore immediately
    // Note: Stripe gives current_period_end as a Unix timestamp (seconds)
    const currentPeriodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    const startDateIso = subscription.start_date
      ? new Date(subscription.start_date * 1000).toISOString()
      : new Date().toISOString();

    const userRef = adminDb.collection("users").doc(userId);

    await userRef.set(
      {
        stripeCustomerId: customer.id,
        subscription: {
          amount: 30, // optional; keep if you rely on it elsewhere
          currency: subscription.currency || "usd",
          priceId: subscription.items?.data?.[0]?.price?.id || subscriptionPriceId,
          plan: "barber_monthly", // optional; keep if you rely on it elsewhere
          status: subscription.status, // likely "incomplete" initially
          subscriptionId: subscription.id,
          startDate: startDateIso,
          currentPeriodEnd: currentPeriodEndIso,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      status: subscription.status,
      invoice: {
        id: subscription.latest_invoice.id,
        amount: subscription.latest_invoice.amount_due,
      },
    });
  } catch (error) {
    console.error("create-subscription error:", error);
    return res.status(500).json({
      error: error?.message,
      type: error?.type || "unknown_error",
    });
  }
}