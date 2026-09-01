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

// ✅ Messaging Service
const MESSAGING_SERVICE_SID =
  process.env.TWILIO_MESSAGING_SERVICE_SID;

/**
 * ✅ FIND TOLL-FREE NUMBER ONLY
 */
async function findAvailableTwilioNumber() {

  console.log(
    "STEP 1 - Searching for available toll-free number"
  );

  try {

    const numbers =
      await twilioClient.availablePhoneNumbers("US")
        .tollFree
        .list({
          limit: 1,
        });

    console.log(
      "STEP 2 - Toll-free numbers returned:",
      numbers.length
    );

    if (numbers.length > 0) {

      console.log(
        `✅ STEP 3 - Found toll-free number: ${numbers[0].phoneNumber}`
      );

      return numbers[0].phoneNumber;
    }

    console.log(
      "❌ STEP 4 - No toll-free numbers available"
    );

    return null;

  } catch (error) {

    console.error(
      "❌ Toll-free lookup failed:",
      error.message
    );

    return null;
  }
}

export default async function handler(req, res) {

  console.log("🔥 CONNECT-RETURN START");

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

  console.log("STEP 5 - SOURCE:", source);

  const adminApp = getAdminApp(source);
  const db = adminApp.firestore();

  const { userId, returnUrl } = req.query || {};

  console.log("STEP 6 - USERID:", userId);

  const fallbackReturnUrl = "barberclean://connect-return";

  const baseReturnUrl =
    typeof returnUrl === "string" && returnUrl.length
      ? returnUrl
      : fallbackReturnUrl;

  const joiner =
    baseReturnUrl.includes("?") ? "&" : "?";

  let redirectTo =
    `${baseReturnUrl}${joiner}success=1`;

  if (!(typeof userId === "string" && userId.length)) {

    console.log("❌ STEP 7 - Missing userId");

    res.statusCode = 302;
    res.setHeader("Location", redirectTo);

    return res.end();
  }

  try {

    console.log("STEP 8 - Loading user:", userId);

    const userRef =
      db.collection("users").doc(userId);

    /**
     * ✅ LOAD EXISTING USER
     */
    const existingSnap = await userRef.get();

    const existingData =
      existingSnap.exists ? existingSnap.data() : null;

    /**
     * ✅ MARK ONBOARDING COMPLETE
     */
    await userRef.set(
      {
        stripeConnectAccountId:
          existingData?.stripeConnectAccountId || null,

        stripeConnectOnboardingComplete: true,

        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    /**
     * ✅ RELOAD USER
     */
    const userSnap = await userRef.get();

    const userData =
      userSnap.exists ? userSnap.data() : null;

    console.log("STEP 9 - USER DATA:", userData);

    const customerEmail = userData?.email;

    if (!customerEmail) {

      console.log("❌ STEP 10 - Missing customer email");

      redirectTo +=
        `&subscription_created=0&reason=missing_email`;

      redirectTo +=
        `&userId=${encodeURIComponent(userId)}`;

      return res.redirect(302, redirectTo);
    }

    /**
     * ✅ ENSURE STRIPE CUSTOMER
     */
    let customerId = userData?.stripeCustomerId;

    if (!customerId) {

      console.log("STEP 11 - Creating Stripe customer");

      const existing =
        await stripe.customers.list({
          email: customerEmail,
          limit: 1,
        });

      customerId =
        existing.data.length > 0
          ? existing.data[0].id
          : (
              await stripe.customers.create({
                email: customerEmail,
                metadata: { userId },
              })
            ).id;

      console.log(
        "✅ STEP 12 - Stripe customerId:",
        customerId
      );

      await userRef.set(
        {
          stripeCustomerId: customerId,
        },
        { merge: true }
      );
    }

    /**
     * 🔥 TWILIO PROVISIONING
     */
    const latestSnap = await userRef.get();

    const latestData = latestSnap.data();

    console.log("STEP 13 - Latest data:", latestData);

    if (
      latestData?.stripeConnectOnboardingComplete &&
      !latestData?.twilioPhoneNumber
    ) {

      console.log(
        "🔥 STEP 14 - ENTERED TWILIO PROVISIONING"
      );

      const phoneNumber =
        await findAvailableTwilioNumber();

      console.log(
        "STEP 15 - phoneNumber result:",
        phoneNumber
      );

      if (phoneNumber) {

        const BASE_URL =
          process.env.PUBLIC_API_BASE_URL;

        console.log(
          "STEP 16 - BASE_URL:",
          BASE_URL
        );

        const incoming =
          await twilioClient.incomingPhoneNumbers.create({
            phoneNumber,

            voiceUrl: `${BASE_URL}/api/voice`,
            voiceMethod: "POST",

            smsUrl: `${BASE_URL}/api/sms-reply`,
            smsMethod: "POST",
          });

        console.log(
          "✅ STEP 17 - Incoming toll-free number created:",
          incoming.phoneNumber
        );

        /**
         * ✅ ADD NUMBER TO VERIFIED MESSAGING SERVICE
         */
        if (MESSAGING_SERVICE_SID) {

          console.log(
            "STEP 18 - Adding toll-free number to Messaging Service"
          );

          await twilioClient.messaging.v1
            .services(MESSAGING_SERVICE_SID)
            .phoneNumbers
            .create({
              phoneNumberSid: incoming.sid,
            });

          console.log(
            "✅ STEP 19 - Toll-free number added to Messaging Service"
          );
        }

        await userRef.set(
          {
            twilioPhoneNumber:
              incoming.phoneNumber,

            twilioSid: incoming.sid,

            twilioProvisionStatus:
              "provisioned",
          },
          { merge: true }
        );

        console.log(
          "✅ STEP 20 - Twilio number saved to Firestore"
        );

      } else {

        console.log(
          "❌ STEP 21 - No toll-free numbers available"
        );
      }

    } else {

      console.log(
        "❌ STEP 22 - Provisioning condition failed"
      );
    }

    redirectTo += `&subscription_created=1`;

  } catch (err) {

    console.error(
      "❌ CONNECT-RETURN ERROR:",
      err
    );

    redirectTo +=
      `&subscription_created=0&reason=provision_failed`;
  }

  redirectTo +=
    `&userId=${encodeURIComponent(userId)}`;

  console.log(
    "STEP 23 - Redirecting:",
    redirectTo
  );

  res.statusCode = 302;
  res.setHeader("Location", redirectTo);

  return res.end();
}