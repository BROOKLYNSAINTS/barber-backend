import "dotenv/config";
import Stripe from "stripe";
import admin from "firebase-admin";
import twilio from "twilio";
import { getAdminDb } from "./_firebaseAdmin.js";
import { verifyAuthToken } from "./_auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// ✅ FIX: trim env values
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

if (!accountSid || !authToken) {
  throw new Error("Twilio env not loaded");
}

const twilioClient = twilio(accountSid, authToken);

const FALLBACK_AREA_CODES = ["718", "347", "917", "646", "929", "516", "201"];

async function findAvailableTwilioNumber() {
  for (const areaCode of FALLBACK_AREA_CODES) {
    try {
      const numbers = await twilioClient.availablePhoneNumbers("US").local.list({
        areaCode,
        limit: 1,
      });

      if (numbers.length > 0) {
        return numbers[0].phoneNumber;
      }
    } catch (error) {
      console.error("Area code check failed:", areaCode, error.message);
    }
  }

  const anyNumbers = await twilioClient.availablePhoneNumbers("US").local.list({
    limit: 1,
  });

  return anyNumbers.length ? anyNumbers[0].phoneNumber : null;
}

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyAuthToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const { userId, customerEmail, setupIntentId, priceId } = req.body;

    if (!userId) return res.status(400).json({ error: "Missing userId" });
    if (user.uid !== userId) {
      return res.status(403).json({ error: "Forbidden: userId mismatch" });
    }
    if (!customerEmail) {
      return res.status(400).json({ error: "Missing customerEmail" });
    }

    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    const userData = snap.exists ? snap.data() : null;

    let customerId = userData?.stripeCustomerId;

    if (!customerId) {
      const existing = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      customerId =
        existing.data.length > 0
          ? existing.data[0].id
          : (await stripe.customers.create({
              email: customerEmail,
              metadata: { userId },
            })).id;
    }

    if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

      if (setupIntent.status !== "succeeded") {
        return res.status(400).json({ error: "SetupIntent not succeeded" });
      }

      const paymentMethodId = setupIntent.payment_method;

      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      }).catch(() => {});

      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      if (priceId || process.env.STRIPE_SUBSCRIPTION_PRICE_ID) {
        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId || process.env.STRIPE_SUBSCRIPTION_PRICE_ID }],
        });

        await userRef.set(
          {
            stripeCustomerId: customerId,
            subscription: {
              subscriptionId: subscription.id,
              status: subscription.status,
            },
          },
          { merge: true }
        );
      }
    }

    const BASE_URL = `http://${req.headers.host}`;

    if (!snap.data()?.twilioPhoneNumber) {
      const phoneNumber = await findAvailableTwilioNumber();

      if (phoneNumber) {
        const incoming = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber,
          voiceUrl: `${BASE_URL}/api/voice`,
          voiceMethod: "POST",
          smsUrl: `${BASE_URL}/api/sms-reply`,
          smsMethod: "POST",
        });

        await userRef.set(
          {
            twilioPhoneNumber: incoming.phoneNumber,
            twilioSid: incoming.sid,
            twilioProvisionStatus: "provisioned",
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("FINAL ERROR:", error);
    return res.status(500).json({
      error: error?.message || "Internal error",
    });
  }
}
