import Stripe from "stripe";
import { verifyAuthToken } from "./_auth.js";
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

    const user = await verifyAuthToken(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const uid = user.uid;
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.data() || {};
    const stripeCustomerId = userData.stripeCustomerId;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: "Missing stripeCustomerId" });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "card",
      limit: 1,
    });

    if (!paymentMethods.data.length) {
      return res.status(400).json({ error: "No payment methods found" });
    }

    const defaultPaymentMethodId = paymentMethods.data[0].id;

    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: defaultPaymentMethodId,
      },
    });

    await userRef.set(
      {
        defaultPaymentMethodId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.status(200).json({
      success: true,
      stripeCustomerId,
      defaultPaymentMethodId,
    });
  } catch (error) {
    console.error("❌ SET DEFAULT PAYMENT ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Internal server error",
    });
  }
}
