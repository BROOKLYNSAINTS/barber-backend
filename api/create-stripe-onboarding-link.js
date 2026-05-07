// api/create-onboarding-link.js

export const config = {
  runtime: "nodejs",
};

import Stripe from "stripe";
import { getAdminApp } from "./_firebaseAdmin.js";
import { verifyAuthToken } from "./_auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const host = req.headers.host;
  const adminApp = getAdminApp(host);
  const db = adminApp.firestore();

  console.log("HOST:", host);
  console.log("VERCEL_ENV:", process.env.VERCEL_ENV);
  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {

    // 🔴 ADD baseUrl here
    const { userId, returnUrl, refreshUrl, baseUrl } = req.body;

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

    // 🔴 FORCE BASE URL FROM FRONTEND
    const resolvedBase =
      baseUrl ||
      returnUrl?.split("/api")[0] ||
      refreshUrl?.split("/api")[0];

    if (!resolvedBase) {
      return res.status(400).json({ error: "Base URL missing" });
    }

    const finalReturn = `${resolvedBase}/api/connect-return`;
    const finalRefresh = `${resolvedBase}/api/connect-return`;

    console.log("USING BASE URL:", resolvedBase);

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: finalRefresh,
      return_url: finalReturn,
      type: "account_onboarding",
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: stripeAccountId,
    });

  } catch (error) {

    console.log("🚨 STRIPE ERROR:", error);

    return res.status(500).json({
      error: "Failed to create onboarding link",
      details: error?.message,
    });

  }
}