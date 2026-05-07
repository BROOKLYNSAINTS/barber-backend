import Stripe from "stripe";
import { getAdminDb } from "./_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const stripeAccountId = await getBarberStripeAccountId(db, userId);

    if (!stripeAccountId) {
      return res.status(200).json({ status: "pending" });
    }

    const account = await stripe.accounts.retrieve(stripeAccountId);

    const isComplete =
      account.charges_enabled && account.payouts_enabled;

    return res.status(200).json({
      status: isComplete ? "complete" : "pending",
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      accountId: stripeAccountId,
    });

  } catch (error) {
    console.error("❌ CHECK ACCOUNT STATUS ERROR:", error);

    return res.status(500).json({
      error: "Failed to check account status",
      details: error.message,
    });
  }
}

async function getBarberStripeAccountId(db, userId) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) return null;

    return userDoc.data()?.stripeAccountId || null;

  } catch (error) {
    return null;
  }
}
