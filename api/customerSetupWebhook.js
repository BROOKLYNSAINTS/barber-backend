// api/customerSetupWebhook.js

import Stripe from "stripe";
import admin from "firebase-admin";

import {
  getAdminDb,
} from "./_firebaseAdmin.js";

/*
 * Stripe webhook signature verification requires the
 * original raw request body.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function cleanString(value) {
  return String(value || "").trim();
}

/*
 * Locate the Firestore customer.
 *
 * Preferred order:
 * 1. Firebase UID stored in Stripe metadata
 * 2. Stripe Customer ID stored in Firestore
 */
async function findCustomerDocument({
  db,
  firebaseUid,
  stripeCustomerId,
}) {
  if (firebaseUid) {
    const doc = await db
      .collection("users")
      .doc(firebaseUid)
      .get();

    if (doc.exists) {
      return doc;
    }
  }

  if (stripeCustomerId) {
    const snapshot = await db
      .collection("users")
      .where(
        "stripeCustomerId",
        "==",
        stripeCustomerId
      )
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0];
    }
  }

  return null;
}

/*
 * Complete payment-method setup and update Firestore.
 */
async function completeCustomerPaymentSetup({
  stripe,
  db,
  setupIntentId,
  stripeCustomerId,
  firebaseUid,
  stripeEventId,
  checkoutSessionId,
}) {
  if (!setupIntentId) {
    throw new Error(
      "Stripe Checkout Session has no SetupIntent."
    );
  }

  const setupIntent =
    await stripe.setupIntents.retrieve(
      setupIntentId
    );

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;

  if (!paymentMethodId) {
    throw new Error(
      "SetupIntent has no payment method."
    );
  }

  const resolvedStripeCustomerId =
    stripeCustomerId ||
    (
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer?.id
    );

  if (!resolvedStripeCustomerId) {
    throw new Error(
      "No Stripe Customer ID was found."
    );
  }

  /*
   * Make the newly saved payment method the default
   * for this Stripe Customer.
   */
  await stripe.customers.update(
    resolvedStripeCustomerId,
    {
      invoice_settings: {
        default_payment_method:
          paymentMethodId,
      },

      metadata: {
        firebaseUid:
          firebaseUid ||
          setupIntent.metadata?.firebaseUid ||
          "",
        paymentSetupComplete: "true",
      },
    }
  );

  const resolvedFirebaseUid =
    firebaseUid ||
    setupIntent.metadata?.firebaseUid ||
    setupIntent.metadata?.customerId ||
    "";

  const customerDoc =
    await findCustomerDocument({
      db,
      firebaseUid: resolvedFirebaseUid,
      stripeCustomerId:
        resolvedStripeCustomerId,
    });

  if (!customerDoc) {
    throw new Error(
      `Firestore customer not found for Stripe customer ${resolvedStripeCustomerId}.`
    );
  }

  const currentCustomer =
    customerDoc.data() || {};

  /*
   * The password may still need to be completed.
   * Payment completion alone should not falsely mark
   * password setup complete.
   */
  const passwordSetupComplete =
    currentCustomer.passwordSetupComplete === true;

  const onboardingComplete =
    passwordSetupComplete === true;

  await customerDoc.ref.set(
    {
      stripeCustomerId:
        resolvedStripeCustomerId,

      defaultPaymentMethodId:
        paymentMethodId,

      paymentSetupComplete: true,
      paymentSetupCompletedAt:
        admin.firestore.FieldValue.serverTimestamp(),

      onboardingComplete,

      status: onboardingComplete
        ? "active"
        : "pending_password_setup",

      stripeSetupIntentId:
        setupIntent.id,

      stripeSetupSessionId:
        checkoutSessionId ||
        currentCustomer.stripeSetupSessionId ||
        null,

      lastStripeWebhookEventId:
        stripeEventId,

      updatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      merge: true,
    }
  );

  console.log(
    "CUSTOMER PAYMENT SETUP COMPLETED:",
    {
      customerId: customerDoc.id,
      stripeCustomerId:
        resolvedStripeCustomerId,
      paymentMethodId,
      setupIntentId:
        setupIntent.id,
      checkoutSessionId,
      onboardingComplete,
    }
  );

  return {
    customerId: customerDoc.id,
    stripeCustomerId:
      resolvedStripeCustomerId,
    paymentMethodId,
    onboardingComplete,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      received: false,
      error: "Method not allowed",
    });
  }

  let event;

  try {
    const stripeSecretKey =
      process.env.STRIPE_SECRET_KEY;

    const webhookSecret =
      process.env
        .STRIPE_CUSTOMER_SETUP_WEBHOOK_SECRET;

    if (!stripeSecretKey) {
      throw new Error(
        "Missing STRIPE_SECRET_KEY."
      );
    }

    if (!webhookSecret) {
      throw new Error(
        "Missing STRIPE_CUSTOMER_SETUP_WEBHOOK_SECRET."
      );
    }

    const stripe =
      new Stripe(stripeSecretKey);

    const signature =
      req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        received: false,
        error:
          "Missing Stripe-Signature header.",
      });
    }

    const rawBody =
      await readRawBody(req);

    /*
     * Verify that the request genuinely came from Stripe.
     */
    event =
      stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );

    const source =
      req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "";

    const db = getAdminDb(source);

    console.log(
      "CUSTOMER SETUP STRIPE EVENT:",
      {
        id: event.id,
        type: event.type,
      }
    );

    /*
     * Main event for the Stripe Checkout setup flow.
     */
    if (
      event.type ===
      "checkout.session.completed"
    ) {
      const session =
        event.data.object;

      /*
       * Ignore normal payment or subscription
       * Checkout Sessions.
       */
      if (session.mode !== "setup") {
        return res.status(200).json({
          received: true,
          ignored: true,
          message:
            "Checkout Session was not a setup session.",
        });
      }

      const setupIntentId =
        typeof session.setup_intent === "string"
          ? session.setup_intent
          : session.setup_intent?.id;

      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;

      const firebaseUid =
        cleanString(
          session.metadata?.firebaseUid ||
          session.metadata?.customerId ||
          session.client_reference_id
        );

      const result =
        await completeCustomerPaymentSetup({
          stripe,
          db,
          setupIntentId,
          stripeCustomerId,
          firebaseUid,
          stripeEventId: event.id,
          checkoutSessionId: session.id,
        });

      return res.status(200).json({
        received: true,
        processed: true,
        eventType: event.type,
        customerId: result.customerId,
        paymentSetupComplete: true,
        onboardingComplete:
          result.onboardingComplete,
      });
    }

    /*
     * Optional fallback:
     * Stripe can also send setup_intent.succeeded.
     *
     * The checkout.session.completed event should
     * normally perform the update. This fallback makes
     * the process more resilient.
     */
    if (
      event.type ===
      "setup_intent.succeeded"
    ) {
      const setupIntent =
        event.data.object;

      const stripeCustomerId =
        typeof setupIntent.customer === "string"
          ? setupIntent.customer
          : setupIntent.customer?.id;

      const firebaseUid =
        cleanString(
          setupIntent.metadata?.firebaseUid ||
          setupIntent.metadata?.customerId
        );

      const customerDoc =
        await findCustomerDocument({
          db,
          firebaseUid,
          stripeCustomerId,
        });

      /*
       * If checkout.session.completed already handled
       * it, acknowledge this event without duplicating
       * the work.
       */
      if (
        customerDoc?.data()
          ?.defaultPaymentMethodId
      ) {
        return res.status(200).json({
          received: true,
          processed: false,
          alreadyCompleted: true,
          eventType: event.type,
        });
      }

      const result =
        await completeCustomerPaymentSetup({
          stripe,
          db,
          setupIntentId: setupIntent.id,
          stripeCustomerId,
          firebaseUid,
          stripeEventId: event.id,
          checkoutSessionId: null,
        });

      return res.status(200).json({
        received: true,
        processed: true,
        eventType: event.type,
        customerId: result.customerId,
        paymentSetupComplete: true,
        onboardingComplete:
          result.onboardingComplete,
      });
    }

    /*
     * Acknowledge Stripe events that this endpoint
     * does not need.
     */
    return res.status(200).json({
      received: true,
      ignored: true,
      eventType: event.type,
    });
  } catch (error) {
    console.error(
      "CUSTOMER SETUP WEBHOOK ERROR:",
      {
        eventId: event?.id || null,
        eventType: event?.type || null,
        message: error.message,
        code: error.code,
        type: error.type,
        stack: error.stack,
      }
    );

    return res.status(400).json({
      received: false,
      error:
        error.message ||
        "Unable to process Stripe webhook.",
    });
  }
}