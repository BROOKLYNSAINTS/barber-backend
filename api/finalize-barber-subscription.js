// api/finalize-barber-subscription.js

import Stripe from "stripe";
import admin from "firebase-admin";
import { adminDb } from "./_firebaseAdmin.js";
import { verifyAuthToken } from "./_auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyAuthToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { userId, customerEmail, setupIntentId, priceId } = req.body;

    if (!userId) return res.status(400).json({ error: "Missing userId" });
    if (user.uid !== userId)
      return res.status(403).json({ error: "Forbidden: userId mismatch" });
    if (!customerEmail)
      return res.status(400).json({ error: "Missing customerEmail" });
    if (!setupIntentId)
      return res.status(400).json({ error: "Missing setupIntentId" });

    const subscriptionPriceId =
      priceId || process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

    if (!subscriptionPriceId) {
      return res
        .status(500)
        .json({ error: "Missing STRIPE_SUBSCRIPTION_PRICE_ID" });
    }

    const userRef = adminDb.collection("users").doc(userId);
    const snap = await userRef.get();
    const userData = snap.exists ? snap.data() : null;

    if (userData?.subscription?.subscriptionId) {
      return res.status(200).json({
        ok: true,
        alreadySubscribed: true,
        subscriptionId: userData.subscription.subscriptionId,
        status: userData.subscription.status,
      });
    }

    // -----------------------------
    // 1️⃣ FIND OR CREATE CUSTOMER
    // -----------------------------
    let customerId = userData?.stripeCustomerId;

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        customerId = null;
      }
    }

    if (!customerId) {
      const existing = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const created = await stripe.customers.create({
          email: customerEmail,
          metadata: { userId },
        });
        customerId = created.id;
      }
    }

    // -----------------------------
    // 2️⃣ VERIFY SETUP INTENT
    // -----------------------------
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({
        error: "SetupIntent not succeeded",
        status: setupIntent.status,
      });
    }

    const paymentMethodId = setupIntent.payment_method;

    if (!paymentMethodId) {
      return res.status(400).json({ error: "No payment method found" });
    }

    // Attach (safe if already attached)
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    } catch {}

    // Set as default
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // -----------------------------
    // 3️⃣ CREATE SUBSCRIPTION (FIXED)
    // -----------------------------
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: subscriptionPriceId }],
      payment_behavior: "allow_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId },
    });

    // -----------------------------
    // 4️⃣ CONFIRM FIRST INVOICE
    // -----------------------------
    const paymentIntent =
      subscription.latest_invoice?.payment_intent;

    if (
      paymentIntent &&
      paymentIntent.status === "requires_confirmation"
    ) {
      await stripe.paymentIntents.confirm(paymentIntent.id);
    }

    // Retrieve updated subscription after confirmation
    const updatedSub = await stripe.subscriptions.retrieve(
      subscription.id
    );

    const startDateIso = updatedSub.start_date
      ? new Date(updatedSub.start_date * 1000).toISOString()
      : new Date().toISOString();

    const currentPeriodEndIso = updatedSub.current_period_end
      ? new Date(updatedSub.current_period_end * 1000).toISOString()
      : null;

    // -----------------------------
    // 5️⃣ WRITE FIRESTORE
    // -----------------------------
    await userRef.set(
      {
        stripeCustomerId: customerId,
        subscription: {
          subscriptionId: updatedSub.id,
          status: updatedSub.status,
          priceId:
            updatedSub.items?.data?.[0]?.price?.id ||
            subscriptionPriceId,
          plan: "barber_monthly",
          amount: 30,
          currency: updatedSub.currency || "usd",
          startDate: startDateIso,
          currentPeriodEnd: currentPeriodEndIso,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({
      ok: true,
      subscriptionId: updatedSub.id,
      status: updatedSub.status,
      customerId,
    });
  } catch (error) {
    console.error("finalize-barber-subscription error:", error);
    return res.status(500).json({
      error: error?.message || "Internal error",
    });
  }
}