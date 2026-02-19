// api/create-payment-with-saved-method.js

import Stripe from "stripe";
import admin from "firebase-admin";
import { adminDb } from "./_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const db = adminDb;

async function writeAppointmentPaymentStatus(appointmentId, paymentIntent) {
  if (!appointmentId) return;

  await db
    .collection("appointments")
    .doc(String(appointmentId))
    .set(
      {
        paymentStatus:
          paymentIntent.status === "succeeded"
            ? "paid"
            : paymentIntent.status,
        ...(paymentIntent.status === "succeeded"
          ? {
              paidAt:
                admin.firestore.FieldValue.serverTimestamp(),
            }
          : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        payment: {
          status: paymentIntent.status,
          paymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          customerId: paymentIntent.customer || null,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed" });
  }

  try {
    const {
      amount,
      customer_id,
      payment_method_id,
      appointmentId,
      appointment_id,
      service_name,
      barber_name,
      appointment_date,
      appointment_time,
      metadata,
    } = req.body;

    const resolvedAppointmentId = String(
      appointmentId ||
        appointment_id ||
        metadata?.appointmentId ||
        metadata?.appointment_id ||
        ""
    ).trim();

    if (!amount || !customer_id || !payment_method_id) {
      return res.status(400).json({
        error:
          "amount, customer_id, and payment_method_id are required",
      });
    }

    const amountInCents = Math.round(Number(amount) * 100);

    const paymentIntent =
      await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: "usd",
        customer: customer_id,
        payment_method: payment_method_id,
        confirmation_method: "automatic",
        confirm: true,
        description: `${service_name} with ${barber_name} on ${appointment_date} at ${appointment_time}`,
        metadata: {
          ...metadata,
          ...(resolvedAppointmentId
            ? {
                appointmentId:
                  resolvedAppointmentId,
                appointment_id:
                  resolvedAppointmentId,
              }
            : {}),
          serviceName: service_name || "",
          barberName: barber_name || "",
          appointmentDate:
            appointment_date || "",
          appointmentTime:
            appointment_time || "",
        },
      });

    await writeAppointmentPaymentStatus(
      resolvedAppointmentId ||
        paymentIntent.metadata?.appointmentId ||
        null,
      paymentIntent
    );

    return res.status(200).json({
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      clientSecret:
        paymentIntent.client_secret,
    });

  } catch (error) {
    return res.status(500).json({
      error: error?.message,
      type: error?.type,
    });
  }
}
