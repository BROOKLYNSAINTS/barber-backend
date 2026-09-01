// api/sendCustomerSetupLink.js

import admin from "firebase-admin";
import Stripe from "stripe";
import twilio from "twilio";

import {
  getAdminDb,
  getAdminAuth,
} from "./_firebaseAdmin.js";

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return null;
}

function cleanString(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      customerFound: false,
      setupLinkSent: false,
      passwordLinkSent: false,
      paymentLinkSent: false,
      error: "Method not allowed",
    });
  }

  let passwordMessage = null;
  let paymentMessage = null;
  let paymentSession = null;

  try {
    const source =
      req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "";

    const db = getAdminDb(source);
    const auth = getAdminAuth(source);

    /*
     * Environment variables
     */
    const stripeSecretKey =
      process.env.STRIPE_SECRET_KEY;

    const twilioAccountSid =
      process.env.TWILIO_ACCOUNT_SID;

    const twilioAuthToken =
      process.env.TWILIO_AUTH_TOKEN;

    const verifiedSmsNumber =
      process.env.TWILIO_VERIFIED_SMS_NUMBER;

    const setupSuccessUrl =
      process.env.CUSTOMER_SETUP_SUCCESS_URL;

    const setupCancelUrl =
      process.env.CUSTOMER_SETUP_CANCEL_URL;

    if (!stripeSecretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY");
    }

    if (!twilioAccountSid) {
      throw new Error("Missing TWILIO_ACCOUNT_SID");
    }

    if (!twilioAuthToken) {
      throw new Error("Missing TWILIO_AUTH_TOKEN");
    }

    if (!verifiedSmsNumber) {
      throw new Error(
        "Missing TWILIO_VERIFIED_SMS_NUMBER"
      );
    }

    if (!setupSuccessUrl) {
      throw new Error(
        "Missing CUSTOMER_SETUP_SUCCESS_URL"
      );
    }

    if (!setupCancelUrl) {
      throw new Error(
        "Missing CUSTOMER_SETUP_CANCEL_URL"
      );
    }

    const senderPhone =
      normalizePhoneNumber(verifiedSmsNumber);

    if (!senderPhone) {
      throw new Error(
        "TWILIO_VERIFIED_SMS_NUMBER is not a valid US phone number"
      );
    }

    const stripe = new Stripe(stripeSecretKey);

    const twilioClient = twilio(
      twilioAccountSid,
      twilioAuthToken
    );

    /*
     * Vapi may provide customerId from the
     * createCustomerAccount result.
     *
     * phoneNumber is customer.number and acts
     * as a fallback lookup.
     */
    const {
      customerId,
      phoneNumber,
    } = req.body || {};

    const normalizedPhone =
      normalizePhoneNumber(phoneNumber);

    if (!customerId && !normalizedPhone) {
      return res.status(400).json({
        success: false,
        customerFound: false,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "customerId or phoneNumber is required",
      });
    }

    /*
     * Locate the Firestore customer document.
     */
    let customerDoc = null;

    if (customerId) {
      const snapshot = await db
        .collection("users")
        .doc(cleanString(customerId))
        .get();

      if (snapshot.exists) {
        customerDoc = snapshot;
      }
    }

    if (!customerDoc && normalizedPhone) {
      const snapshot = await db
        .collection("users")
        .where("phone", "==", normalizedPhone)
        .where("role", "==", "customer")
        .limit(1)
        .get();

      if (!snapshot.empty) {
        customerDoc = snapshot.docs[0];
      }
    }

    if (!customerDoc) {
      return res.status(404).json({
        success: false,
        customerFound: false,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error: "Customer account not found",
        message:
          "The customer account could not be located.",
      });
    }

    const customer = customerDoc.data() || {};
    const firebaseUid = customerDoc.id;

    const customerName =
      cleanString(customer.name) || "Customer";

    const customerEmail =
      cleanString(customer.email).toLowerCase();

    const customerPhone =
      normalizePhoneNumber(customer.phone);

    const stripeCustomerId =
      cleanString(customer.stripeCustomerId);

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        customerFound: true,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "Customer Firestore document has no email address",
      });
    }

    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        customerFound: true,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "Customer Firestore document has no valid phone number",
      });
    }

    if (!stripeCustomerId) {
      return res.status(400).json({
        success: false,
        customerFound: true,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "Customer Firestore document has no Stripe customer ID",
      });
    }

    /*
     * Confirm the Firebase Authentication user exists.
     */
    const authUser = await auth.getUser(firebaseUid);

    if (!authUser.email) {
      return res.status(400).json({
        success: false,
        customerFound: true,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "Firebase Authentication user has no email address",
      });
    }

    if (
      authUser.email.toLowerCase() !== customerEmail
    ) {
      return res.status(400).json({
        success: false,
        customerFound: true,
        setupLinkSent: false,
        passwordLinkSent: false,
        paymentLinkSent: false,
        error:
          "Firebase Authentication email does not match the Firestore email",
      });
    }

    /*
     * Generate the secure Firebase password setup link.
     *
     * No password is collected through Vapi.
     */
    const passwordSetupLink =
      await auth.generatePasswordResetLink(
        customerEmail
      );

    /*
     * Create a Stripe-hosted Checkout Session.
     *
     * Stripe collects the card number, expiration date,
     * and security code directly on its hosted page.
     */
    const separator =
      setupSuccessUrl.includes("?") ? "&" : "?";

    paymentSession =
      await stripe.checkout.sessions.create({
        mode: "setup",

        customer: stripeCustomerId,

        currency: "usd",

        payment_method_types: ["card"],

        client_reference_id: firebaseUid,

        success_url:
          `${setupSuccessUrl}${separator}` +
          "session_id={CHECKOUT_SESSION_ID}",

        cancel_url: setupCancelUrl,

        metadata: {
          firebaseUid,
          customerId: firebaseUid,
          customerPhone,
          source: "vapi_phone_onboarding",
        },

        setup_intent_data: {
          metadata: {
            firebaseUid,
            customerId: firebaseUid,
            customerPhone,
            source: "vapi_phone_onboarding",
          },
        },
      });

    if (!paymentSession.url) {
      throw new Error(
        "Stripe did not return a payment setup URL"
      );
    }

    /*
     * Send password setup message from the shared,
     * verified toll-free SMS number.
     */
    passwordMessage =
      await twilioClient.messages.create({
        from: senderPhone,
        to: customerPhone,
        body:
          `Hi ${customerName}. Welcome to ScheduleSync! ` +
          `Use this secure link to create your account password: ` +
          `${passwordSetupLink} ` +
          `Do not share this link with anyone.`,
      });

    /*
     * Send payment setup message separately because
     * secure URLs can be long.
     */
    paymentMessage =
      await twilioClient.messages.create({
        from: senderPhone,
        to: customerPhone,
        body:
          `Use this secure Stripe link to add your payment method: ` +
          `${paymentSession.url} ` +
          `For your security, never text or speak your card number.`,
      });

    /*
     * Update Firestore only after both messages
     * have been accepted by Twilio.
     */
    await customerDoc.ref.update({
      setupLinkSent: true,
      setupLinkSentAt:
        admin.firestore.FieldValue.serverTimestamp(),

      setupSmsFrom: senderPhone,

      passwordSetupLinkSent: true,
      passwordSetupLinkSentAt:
        admin.firestore.FieldValue.serverTimestamp(),

      passwordSetupMessageSid:
        passwordMessage.sid,

      paymentSetupLinkSent: true,
      paymentSetupLinkSentAt:
        admin.firestore.FieldValue.serverTimestamp(),

      paymentSetupMessageSid:
        paymentMessage.sid,

      stripeSetupSessionId:
        paymentSession.id,

      onboardingComplete: false,

      passwordSetupComplete:
        customer.passwordSetupComplete === true,

      paymentSetupComplete:
        Boolean(customer.defaultPaymentMethodId),

      status: customer.defaultPaymentMethodId
        ? "active"
        : "pending_setup",

      updatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("CUSTOMER SETUP LINKS SENT:", {
      customerId: firebaseUid,
      customerPhone,
      senderPhone,
      stripeSessionId: paymentSession.id,
      passwordMessageSid: passwordMessage.sid,
      paymentMessageSid: paymentMessage.sid,
    });

    /*
     * Never return either secure URL to Vapi.
     */
    return res.status(200).json({
      success: true,
      customerFound: true,

      setupLinkSent: true,
      passwordLinkSent: true,
      paymentLinkSent: true,

      customerId: firebaseUid,
      customerName,
      phoneNumber: customerPhone,

      stripeSetupSessionId:
        paymentSession.id,

      message:
        "Secure password and payment setup links were sent to the customer by text message.",
    });
  } catch (error) {
    console.error("SEND CUSTOMER SETUP LINK ERROR:", {
      message: error.message,
      code: error.code,
      type: error.type,
      statusCode: error.statusCode,
      stack: error.stack,
    });

    /*
     * Record partial delivery if the first message was
     * sent but a later operation failed.
     */
    const passwordLinkSent =
      Boolean(passwordMessage?.sid);

    const paymentLinkSent =
      Boolean(paymentMessage?.sid);

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,

        setupLinkSent:
          passwordLinkSent && paymentLinkSent,

        passwordLinkSent,
        paymentLinkSent,

        stripeSetupSessionCreated:
          Boolean(paymentSession?.id),

        error:
          error.message ||
          "Unable to send customer setup links.",

        errorCode:
          error.code || error.type || null,

        message:
          passwordLinkSent && !paymentLinkSent
            ? "The password setup text was sent, but the payment setup text could not be sent."
            : "The secure customer setup links could not be sent.",
      });
  }
}