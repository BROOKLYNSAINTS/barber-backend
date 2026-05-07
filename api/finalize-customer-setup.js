import Stripe from "stripe";
import { verifyAuthToken } from "./_auth.js";
import { getAdminDb } from "./_firebaseAdmin.js";
import admin from "firebase-admin";

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
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { setupIntentId } = req.body;
    if (!setupIntentId) {
      return res.status(400).json({ error: "Missing setupIntentId" });
    }

    const userRef = db.collection("users").doc(user.uid);
    const snap = await userRef.get();
    const userData = snap.exists ? snap.data() : null;

    if (!userData?.stripeCustomerId) {
      return res.status(400).json({ error: "Customer not found" });
    }

    const customerId = userData.stripeCustomerId;

    // 1️⃣ Retrieve SetupIntent
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

    // 2️⃣ Attach payment method
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    } catch {}

    // 3️⃣ Set as default in Stripe
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 4️⃣ Write to Firestore
    await userRef.set(
      {
        defaultPaymentMethodId: paymentMethodId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({
      success: true,
      defaultPaymentMethodId: paymentMethodId,
    });
  } catch (error) {
    console.error("finalize-customer-setup error:", error);
    return res.status(500).json({
      error: error?.message || "Internal error",
    });
  }
}
