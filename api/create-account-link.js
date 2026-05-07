// api/create-account-link.js

import Stripe from "stripe";
import { getAdminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const bypassSecret = req.query["x-vercel-protection-bypass"];
  if (bypassSecret !== process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const { barberId, email } = req.body;
    const name = req.body.name || "Barber Business";

    const returnUrl =
      req.body.returnUrl ||
      req.body.return_url ||
      "barberclean://stripe-connect-return";

    const refreshUrl =
      req.body.refreshUrl ||
      req.body.refresh_url ||
      "barberclean://stripe-connect-refresh";

    if (!barberId || !email) {
      return res
        .status(400)
        .json({ error: "Missing required parameters" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    let account;

    const accounts = await stripe.accounts.list({ limit: 100 });
    account = accounts.data.find(
      (acc) => acc.metadata?.barberId === barberId
    );

    if (!account) {
      account = await stripe.accounts.create({
        type: "express",
        metadata: {
          barberId,
          userEmail: email,
        },
        business_profile: {
          name,
          product_description: "Barber Services",
          support_email: email,
        },
        business_type: "individual",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
    }

    await db.collection("users").doc(barberId).update({
      stripeAccountId: account.id,
      stripeAccountUpdatedAt: new Date().toISOString(),
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: account.id,
    });

  } catch (error) {
    console.error("❌ CREATE ACCOUNT LINK ERROR:", error);

    return res.status(500).json({ error: error.message });
  }
}
