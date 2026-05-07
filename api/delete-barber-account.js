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
      return res.status(400).json({ error: "Missing userId" });
    }

    // 🔎 Get barber document
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = snap.data();

    const subscriptionId =
      userData.subscription?.subscriptionId;

    const stripeConnectAccountId =
      userData.stripeConnectAccountId;

    // 💳 Cancel Stripe subscription
    if (subscriptionId) {
      await stripe.subscriptions.cancel(subscriptionId);
    }

    // 🏦 Optional: disable Connect account payouts
    if (stripeConnectAccountId) {
      await stripe.accounts.update(stripeConnectAccountId, {
        metadata: { accountDeletedInApp: "true" },
      });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("❌ DELETE BARBER ACCOUNT ERROR:", error);

    return res.status(500).json({ error: "Internal server error" });
  }
}
