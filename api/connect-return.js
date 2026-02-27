// api/connect-return.js

import Stripe from "stripe";
import { adminDb } from "./_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const { state, account, returnUrl } = req.query || {};

  const fallbackReturnUrl = "barberclean://stripe-connect-return";

  const baseReturnUrl =
    typeof returnUrl === "string" && returnUrl.length
      ? returnUrl
      : fallbackReturnUrl;

  const joiner = baseReturnUrl.includes("?") ? "&" : "?";

  let redirectTo = `${baseReturnUrl}${joiner}success=1`;

  // If we don't have userId (state) we can't attach subscription to user doc
  if (!(typeof state === "string" && state.length)) {
    res.statusCode = 302;
    res.setHeader("Location", redirectTo);
    return res.end();
  }

  const userId = state;

  try {
    // 1) Update Firestore: Connect onboarding complete
    if (typeof account === "string" && account.length) {
      await adminDb.collection("users").doc(userId).set(
        {
          stripeConnectAccountId: account,
          stripeConnectOnboardingComplete: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } else {
      await adminDb.collection("users").doc(userId).set(
        {
          stripeConnectOnboardingComplete: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    // 2) Load user profile to get email (required for Stripe customer)
    const userSnap = await adminDb.collection("users").doc(userId).get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const customerEmail = userData?.email;
    if (!customerEmail) {
      // Can't create a Stripe customer without email in your current design
      redirectTo += `&subscription_created=0&reason=${encodeURIComponent(
        "missing_email"
      )}`;
      redirectTo += `&state=${encodeURIComponent(userId)}`;
      if (account) redirectTo += `&account=${encodeURIComponent(account)}`;

      res.statusCode = 302;
      res.setHeader("Location", redirectTo);
      return res.end();
    }

    // If subscription already exists in Firestore, don't create another
    const existingSubId = userData?.subscription?.subscriptionId;
    if (existingSubId) {
      redirectTo += `&subscription_created=0&already_subscribed=1`;
      redirectTo += `&state=${encodeURIComponent(userId)}`;
      if (account) redirectTo += `&account=${encodeURIComponent(account)}`;

      res.statusCode = 302;
      res.setHeader("Location", redirectTo);
      return res.end();
    }

    const subscriptionPriceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
    if (!subscriptionPriceId) {
      redirectTo += `&subscription_created=0&reason=${encodeURIComponent(
        "missing_price_id"
      )}`;
      redirectTo += `&state=${encodeURIComponent(userId)}`;
      if (account) redirectTo += `&account=${encodeURIComponent(account)}`;

      res.statusCode = 302;
      res.setHeader("Location", redirectTo);
      return res.end();
    }

    // 3) Find or create Stripe customer (prefer using stored stripeCustomerId)
    let customerId = userData?.stripeCustomerId;

    if (customerId) {
      // sanity check: ensure customer exists
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        customerId = null;
      }
    }

    if (!customerId) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
        if (existingCustomers.data[0].metadata?.userId !== userId) {
          await stripe.customers.update(customerId, {
            metadata: { userId },
          });
        }
      } else {
        const created = await stripe.customers.create({
          email: customerEmail,
          metadata: { userId },
        });
        customerId = created.id;
      }
    }

    // 4) Create subscription
    // NOTE: This creates a subscription. If you require collecting a card in-app,
    // this may create "incomplete" until payment is confirmed.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: subscriptionPriceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      metadata: { userId },
    });

    const currentPeriodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    const startDateIso = subscription.start_date
      ? new Date(subscription.start_date * 1000).toISOString()
      : new Date().toISOString();

    // 5) Write Firestore subscription fields immediately
    await adminDb.collection("users").doc(userId).set(
      {
        stripeCustomerId: customerId,
        subscription: {
          subscriptionId: subscription.id,
          status: subscription.status,
          priceId: subscription.items?.data?.[0]?.price?.id || subscriptionPriceId,
          plan: "barber_monthly",
          amount: 30,
          currency: subscription.currency || "usd",
          startDate: startDateIso,
          currentPeriodEnd: currentPeriodEndIso,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    redirectTo += `&subscription_created=1`;
  } catch (err) {
    console.error("connect-return subscription provisioning error:", err);
    redirectTo += `&subscription_created=0&reason=${encodeURIComponent(
      "provision_failed"
    )}`;
  }

  redirectTo += `&state=${encodeURIComponent(state)}`;
  if (account) redirectTo += `&account=${encodeURIComponent(account)}`;

  res.statusCode = 302;
  res.setHeader("Location", redirectTo);
  return res.end();
}