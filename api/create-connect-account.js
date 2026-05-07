// api/create-connect-account.js

import Stripe from "stripe";
import { verifyAuthToken } from "./_auth.js";
import { getAdminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyAuthToken(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const {
      userId,
      email,
      businessType = "individual",
      returnUrl,
      refreshUrl,
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: businessType,
      metadata: { userId },
    });

    await db.collection("users").doc(userId).update({
      stripeConnectAccountId: account.id,
      stripeConnectOnboardingComplete: false,
    });

    // ✅ dynamic base URL
    const API_BASE =
      process.env.PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL;

    if (!API_BASE) {
      throw new Error("API_BASE not configured in environment variables");
    }

    const fallbackAppReturnUrl = "barberclean://connect-return";

    const appReturnUrl =
      typeof returnUrl === "string" && returnUrl.length
        ? returnUrl
        : fallbackAppReturnUrl;

    const appRefreshUrl =
      typeof refreshUrl === "string" && refreshUrl.length
        ? refreshUrl
        : appReturnUrl;

    const stripeReturnEndpoint =
      `${API_BASE}/api/connect-return?returnUrl=${encodeURIComponent(
        appReturnUrl
      )}&account=${encodeURIComponent(
        account.id
      )}&state=${encodeURIComponent(userId)}`;

    const stripeRefreshEndpoint =
      `${API_BASE}/api/connect-refresh?returnUrl=${encodeURIComponent(
        appRefreshUrl
      )}&account=${encodeURIComponent(
        account.id
      )}&state=${encodeURIComponent(userId)}`;

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      return_url: stripeReturnEndpoint,
      refresh_url: stripeRefreshEndpoint,
    });

    return res.status(200).json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
    });

  } catch (error) {
    console.error("❌ CREATE CONNECT ACCOUNT ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Failed to create Connect account",
    });
  }
}
