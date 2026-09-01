// api/createCustomerAccount.js

import admin from "firebase-admin";
import Stripe from "stripe";
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

function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function cleanString(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      customerCreated: false,
      error: "Method not allowed",
    });
  }

  let db = null;
  let auth = null;
  let stripe = null;

  let firebaseUser = null;
  let stripeCustomer = null;
  let firestoreDocumentCreated = false;

  try {
    const source =
      req.headers.host ||
      req.headers["x-forwarded-host"] ||
      "";

    db = getAdminDb(source);
    auth = getAdminAuth(source);

    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error(
        "Missing STRIPE_SECRET_KEY environment variable."
      );
    }

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      name,
      email,
      phoneNumber,
      address,
      zipcode,
    } = req.body || {};

    const customerName = cleanString(name);
    const customerEmail = normalizeEmail(email);
    const customerPhone =
      normalizePhoneNumber(phoneNumber);
    const customerAddress = cleanString(address);
    const customerZipcode = cleanString(zipcode);

    if (!customerName) {
      return res.status(400).json({
        success: false,
        customerCreated: false,
        field: "name",
        error: "Customer name is required.",
      });
    }

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        customerCreated: false,
        field: "email",
        error: "A valid email address is required.",
      });
    }

    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        customerCreated: false,
        field: "phoneNumber",
        error: "A valid phone number is required.",
      });
    }

    console.log("CREATE CUSTOMER ACCOUNT:", {
      name: customerName,
      email: customerEmail,
      phoneNumber: customerPhone,
    });

    /*
     * Check Firestore for an existing phone number.
     */
    const phoneSnapshot = await db
      .collection("users")
      .where("phone", "==", customerPhone)
      .limit(1)
      .get();

    if (!phoneSnapshot.empty) {
      const existingDoc = phoneSnapshot.docs[0];
      const existingCustomer = existingDoc.data();

      return res.status(200).json({
        success: true,
        customerCreated: false,
        customerAlreadyExists: true,

        customerId: existingDoc.id,
        firebaseUid: existingDoc.id,

        customerName: existingCustomer.name || "",
        email: existingCustomer.email || "",
        phoneNumber:
          existingCustomer.phone || customerPhone,

        stripeCustomerId:
          existingCustomer.stripeCustomerId || null,

        hasPaymentMethod: Boolean(
          existingCustomer.defaultPaymentMethodId
        ),

        setupRequired: !Boolean(
          existingCustomer.defaultPaymentMethodId
        ),

        message:
          "A customer account already exists for this phone number.",
      });
    }

    /*
     * Check Firestore for an existing email.
     */
    const emailSnapshot = await db
      .collection("users")
      .where("email", "==", customerEmail)
      .limit(1)
      .get();

    if (!emailSnapshot.empty) {
      return res.status(409).json({
        success: false,
        customerCreated: false,
        customerAlreadyExists: true,
        customerId: emailSnapshot.docs[0].id,
        error:
          "An account already exists for this email address.",
        message:
          "Use a different email address or complete the existing account setup.",
      });
    }

    /*
     * Check Firebase Authentication by email.
     */
    try {
      const existingUser =
        await auth.getUserByEmail(customerEmail);

      return res.status(409).json({
        success: false,
        customerCreated: false,
        customerAlreadyExists: true,
        firebaseUid: existingUser.uid,
        error:
          "A Firebase Authentication account already exists for this email.",
      });
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        throw error;
      }
    }

    /*
     * Check Firebase Authentication by phone.
     */
    try {
      const existingUser =
        await auth.getUserByPhoneNumber(customerPhone);

      return res.status(409).json({
        success: false,
        customerCreated: false,
        customerAlreadyExists: true,
        firebaseUid: existingUser.uid,
        error:
          "A Firebase Authentication account already exists for this phone number.",
      });
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        throw error;
      }
    }

    /*
     * Create Firebase Authentication account.
     *
     * No password is collected during the call.
     */
    firebaseUser = await auth.createUser({
      email: customerEmail,
      emailVerified: false,
      phoneNumber: customerPhone,
      displayName: customerName,
      disabled: false,
    });

    await auth.setCustomUserClaims(firebaseUser.uid, {
      role: "customer",
      userType: "customer",
    });

    /*
     * Create Stripe Customer.
     */
    const stripeCustomerData = {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,

      metadata: {
        firebaseUid: firebaseUser.uid,
        role: "customer",
        source: "vapi_phone_onboarding",
      },
    };

    if (customerAddress || customerZipcode) {
      stripeCustomerData.address = {
        line1: customerAddress || undefined,
        postal_code: customerZipcode || undefined,
        country: "US",
      };
    }

    stripeCustomer = await stripe.customers.create(
      stripeCustomerData,
      {
        idempotencyKey:
          `vapi-customer-${firebaseUser.uid}`,
      }
    );

    /*
     * Create Firestore customer document.
     */
    const customerDocument = {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      address: customerAddress,
      zipcode: customerZipcode,

      role: "customer",
      userType: "customer",

      stripeCustomerId: stripeCustomer.id,
      defaultPaymentMethodId: null,

      onboardingComplete: false,
      passwordSetupComplete: false,
      paymentSetupComplete: false,
      setupLinkSent: false,

      status: "pending_setup",

      notificationToken: "",
      notificationsEnabled: true,

      metrics: {
        recoveredRevenue: 0,
      },

      subscription: {
        status: "inactive",
      },

      accountSource: "vapi_phone_onboarding",

      createdAt: new Date().toISOString(),

      updatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    await db
      .collection("users")
      .doc(firebaseUser.uid)
      .set(customerDocument);

    firestoreDocumentCreated = true;

    console.log("CUSTOMER ACCOUNT CREATED:", {
      firebaseUid: firebaseUser.uid,
      stripeCustomerId: stripeCustomer.id,
      phoneNumber: customerPhone,
    });

    return res.status(201).json({
      success: true,
      customerCreated: true,
      customerAlreadyExists: false,

      customerId: firebaseUser.uid,
      firebaseUid: firebaseUser.uid,

      customerName,
      email: customerEmail,
      phoneNumber: customerPhone,

      stripeCustomerId: stripeCustomer.id,
      hasPaymentMethod: false,

      setupRequired: true,
      passwordSetupRequired: true,
      paymentSetupRequired: true,

      message:
        "Customer account created. Send the customer a secure setup link.",
    });
  } catch (error) {
    console.error("CREATE CUSTOMER ACCOUNT ERROR:", {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack,
    });

    if (
      firestoreDocumentCreated &&
      firebaseUser?.uid &&
      db
    ) {
      try {
        await db
          .collection("users")
          .doc(firebaseUser.uid)
          .delete();
      } catch (rollbackError) {
        console.error(
          "FIRESTORE ROLLBACK FAILED:",
          rollbackError
        );
      }
    }

    if (stripeCustomer?.id && stripe) {
      try {
        await stripe.customers.del(
          stripeCustomer.id
        );
      } catch (rollbackError) {
        console.error(
          "STRIPE ROLLBACK FAILED:",
          rollbackError
        );
      }
    }

    if (firebaseUser?.uid && auth) {
      try {
        await auth.deleteUser(firebaseUser.uid);
      } catch (rollbackError) {
        console.error(
          "FIREBASE AUTH ROLLBACK FAILED:",
          rollbackError
        );
      }
    }

    let statusCode = 500;

    if (
      error.code === "auth/email-already-exists" ||
      error.code === "auth/phone-number-already-exists"
    ) {
      statusCode = 409;
    }

    if (
      error.type === "StripeInvalidRequestError"
    ) {
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      customerCreated: false,

      error:
        error.message ||
        "Unable to create customer account.",

      errorCode:
        error.code || error.type || null,

      message:
        "The customer account could not be created.",
    });
  }
}