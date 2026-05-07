import Stripe from "stripe";
import admin from "firebase-admin";
import { getAdminDb } from "./_firebaseAdmin.js";
import { buffer } from "micro";
import twilio from "twilio";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

const twilioClient =
  accountSid && authToken ? twilio(accountSid, authToken) : null;

const FALLBACK_AREA_CODES = ["718", "347", "917", "646", "929", "516", "201"];

async function findAvailableTwilioNumber() {
  if (!twilioClient) return null;

  for (const areaCode of FALLBACK_AREA_CODES) {
    try {
      const numbers =
        await twilioClient.availablePhoneNumbers("US").local.list({
          areaCode,
          limit: 1,
        });

      if (numbers.length > 0) return numbers[0].phoneNumber;
    } catch {}
  }

  const anyNumbers =
    await twilioClient.availablePhoneNumbers("US").local.list({ limit: 1 });

  return anyNumbers.length ? anyNumbers[0].phoneNumber : null;
}

/* =========================
   🔌 AGENT ALERT FUNCTION
========================= */
async function sendToAgent(type, message, data = {}, req) {
  try {
    const baseUrl = `https://${req.headers.host}`;

    await fetch(`${baseUrl}/api/agent-monitor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "stripe",
        type,
        message,
        data,
      }),
    });
  } catch (err) {
    console.log("Agent alert failed:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const db = getAdminDb(req.headers.host);
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).send("Webhook not configured");
  }

  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  /* =========================
     🚫 DUPLICATE PROTECTION
  ========================= */
  try {
    const eventId = event.id;

    const existing = await db
      .collection("stripe_events")
      .doc(eventId)
      .get();

    if (existing.exists) {
      console.log("Duplicate event skipped:", eventId);
      return res.status(200).json({ received: true });
    }

    await db.collection("stripe_events").doc(eventId).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.log("Dedupe check failed:", err.message);
  }

  try {
    /* =========================
       ✅ PAYMENT SUCCESS
    ========================= */
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      const appointmentId = pi.metadata?.appointmentId;
      const paymentCategory = String(
        pi.metadata?.paymentCategory || pi.metadata?.type || "service"
      )
        .toLowerCase()
        .trim();

      const customerId = pi.customer;
      const paymentMethodId = pi.payment_method;

      if (customerId && paymentMethodId) {
        try {
          await stripe.customers.update(customerId, {
            invoice_settings: {
              default_payment_method: paymentMethodId,
            },
          });

          const userSnap = await db
            .collection("users")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get();

          if (!userSnap.empty) {
            await userSnap.docs[0].ref.set(
              {
                defaultPaymentMethodId: paymentMethodId,
                updatedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        } catch {}
      }

      if (appointmentId) {
        const apptRef = db.collection("appointments").doc(appointmentId);

        const baseUpdate = {
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          payment: {
            paymentIntentId: pi.id,
            amount: pi.amount,
            currency: pi.currency,
            status: pi.status,
            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          },
        };

        if (paymentCategory.includes("tip")) {
          await apptRef.set(
            {
              ...baseUpdate,
              tipStatus: "paid",
              tipAmountPaid: pi.amount / 100,
              tipPaymentIntentId: pi.id,
              tipPaidAt:
                admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          await apptRef.set(
            {
              ...baseUpdate,
              paymentStatus: "paid",
              amountPaid: pi.amount / 100,
              paymentIntentId: pi.id,
              paidAt:
                admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    /* =========================
       🚨 PAYMENT FAILED
    ========================= */
    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;

      await sendToAgent(
        "payment_failed",
        `Payment failed (PI: ${pi.id})`,
        pi,
        req
      );
    }

    /* =========================
       🚨 PAYOUT FAILED
    ========================= */
    if (event.type === "payout.failed") {
      const payout = event.data.object;

      await sendToAgent(
        "payout_failed",
        `Payout failed for account ${payout.destination || "unknown"}`,
        payout,
        req
      );
    }

    /* =========================
       ⚙️ ONBOARDING STATUS
    ========================= */
    if (event.type === "account.updated") {
      const account = event.data.object;

      const isComplete =
        account.details_submitted && account.charges_enabled;

      if (!isComplete) {
        await sendToAgent(
          "onboarding_incomplete",
          "Barber onboarding incomplete",
          account,
          req
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.log("Webhook error:", err);
    return res.status(500).send("Webhook handler failed");
  }
}