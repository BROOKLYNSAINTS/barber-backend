// api/create-account-link.js
import Stripe from "stripe";
import { adminDb } from "./_firebaseAdmin.js";

const db = adminDb;

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
    const { barberId, email, name, returnUrl, refreshUrl } = req.body;

    if (!barberId || !email || !returnUrl || !refreshUrl) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    let account;

    try {
      const accounts = await stripe.accounts.list({
        limit: 1,
        email,
      });

      account = accounts.data[0];
    } catch (err) {
      console.error("Error finding account:", err);
    }

    if (!account) {
      account = await stripe.accounts.create({
        type: "express",
        email,
        metadata: {
          barberId,
        },
        business_profile: {
          name: name || "Barber Service",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      try {
        await db.collection("users").doc(barberId).update({
          stripeAccountId: account.id,
          stripeAccountCreatedAt: new Date().toISOString(),
          stripeAccountSetupComplete: false,
        });
      } catch (dbError) {
        console.error("Error storing Stripe account ID:", dbError);
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: accountLink.url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
