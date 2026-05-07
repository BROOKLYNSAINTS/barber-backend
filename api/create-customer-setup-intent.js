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
    const user = await verifyAuthToken(req);
    if (!user || !user.uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const uid = user.uid;
    const { customerEmail, customerName } = req.body;

    const host =
      req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "";

    const db = getAdminDb(host);
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    let stripeCustomerId = userSnap.data()?.stripeCustomerId;

    /* -------------------------------
       CREATE CUSTOMER IF NEEDED
    --------------------------------*/
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName || "Customer",
      });

      stripeCustomerId = customer.id;

      await userRef.set(
        { stripeCustomerId },
        { merge: true }
      );
    }

    /* -------------------------------
       🔥 LINK PAYMENT METHOD (AFTER SAVE)
    --------------------------------*/
    const methods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "card",
    });

    if (methods.data.length > 0) {
      const pm = methods.data[0].id;

      // SET DEFAULT IN STRIPE
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: pm,
        },
      });

      // SAVE REAL VALUE IN FIRESTORE
      await userRef.set(
        {
          defaultPaymentMethodId: pm,
        },
        { merge: true }
      );
    }

    /* -------------------------------
       CREATE SETUP INTENT
    --------------------------------*/
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: "2023-10-16" }
    );

    return res.status(200).json({
      clientSecret: setupIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId: stripeCustomerId,
    });

  } catch (error) {
    console.error("❌ SETUP ERROR:", error);

    return res.status(500).json({
      error: error.message,
    });
  }
}
