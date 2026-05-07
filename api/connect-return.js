// api/connect-return.js

import Stripe from "stripe";
import { getAdminApp } from "./_firebaseAdmin.js";
import twilio from "twilio";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// ✅ Twilio setup
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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const source =
    req.headers["x-backend-base-url"] ||
    req.headers.host;

  const adminApp = getAdminApp(source);
  const db = adminApp.firestore();

  const { state, account, returnUrl } = req.query || {};

  const fallbackReturnUrl = "barberclean://connect-return";
  const baseReturnUrl =
    typeof returnUrl === "string" && returnUrl.length
      ? returnUrl
      : fallbackReturnUrl;

  const joiner = baseReturnUrl.includes("?") ? "&" : "?";

  let redirectTo = `${baseReturnUrl}${joiner}success=1`;

  if (!(typeof state === "string" && state.length)) {
    res.statusCode = 302;
    res.setHeader("Location", redirectTo);
    return res.end();
  }

  const userId = state;

  try {
    const userRef = db.collection("users").doc(userId);

    // ✅ 1. Mark onboarding complete
    await userRef.set(
      {
        stripeConnectAccountId: account || null,
        stripeConnectOnboardingComplete: true,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // ✅ 2. Load user
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const customerEmail = userData?.email;

    if (!customerEmail) {
      redirectTo += `&subscription_created=0&reason=missing_email`;
      redirectTo += `&state=${encodeURIComponent(userId)}`;
      return res.redirect(302, redirectTo);
    }

    // ✅ 3. Ensure Stripe customer
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

    // ✅ 4. Ensure subscription (safe)
    if (!userData?.subscription?.subscriptionId) {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID }],
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

    // 🔥 5. TWILIO PROVISIONING (THIS IS THE FIX)
    const latestSnap = await userRef.get();
    const latestData = latestSnap.data();

    if (
      latestData?.stripeConnectOnboardingComplete &&
      latestData?.subscription?.status === "active" &&
      !latestData?.twilioPhoneNumber
    ) {
      console.log("🔥 Provisioning Twilio number...");

      const phoneNumber = await findAvailableTwilioNumber();

      if (phoneNumber) {
        const BASE_URL = process.env.PUBLIC_API_BASE_URL;

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

        console.log("✅ Twilio number assigned:", incoming.phoneNumber);
      } else {
        console.log("❌ No Twilio numbers available");
      }
    }

    redirectTo += `&subscription_created=1`;

  } catch (err) {
    console.error("connect-return error:", err);
    redirectTo += `&subscription_created=0&reason=provision_failed`;
  }

  redirectTo += `&state=${encodeURIComponent(state)}`;
  if (account) redirectTo += `&account=${encodeURIComponent(account)}`;

  res.statusCode = 302;
  res.setHeader("Location", redirectTo);
  return res.end();
}