// api/create-onboarding-link.js

import Stripe from "stripe";
import { adminDb } from "./_firebaseAdmin.js";
import { verifyAuthToken } from "./_auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const db = adminDb;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { userId, refreshUrl, returnUrl } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();

    let stripeAccountId = userSnap.exists
      ? userSnap.data()?.stripeConnectAccountId || null
      : null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { userId },
      });

      stripeAccountId = account.id;

      await userRef.set(
        {
          stripeConnectAccountId: stripeAccountId,
          stripeConnectOnboardingComplete: false,
        },
        { merge: true }
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url:
        refreshUrl ||
        "https://barber-backend-ten.vercel.app/api/connect-refresh",
      return_url:
        returnUrl ||
        "https://barber-backend-ten.vercel.app/api/connect-return",
      type: "account_onboarding",
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: stripeAccountId,
    });

  } catch (error) {
    return res.status(500).json({
      error: "Failed to create onboarding link",
      details: error?.message,
    });
  }
}
