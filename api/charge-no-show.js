import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { appointmentId } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: "Missing appointmentId" });
    }

    /**
     * 1️⃣ Load appointment
     */
    const apptRef = db.collection("appointments").doc(appointmentId);
    const apptSnap = await apptRef.get();

    if (!apptSnap.exists) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = apptSnap.data();

    if (!appointment.noShowProtection?.enabled) {
      return res.status(400).json({ error: "No-show protection not enabled" });
    }

    if (appointment.noShowProtection.status === "charged") {
      return res.status(200).json({ message: "Already charged" });
    }

    /**
     * 2️⃣ Calculate charge amount
     */
    let amount;

    if (appointment.noShowProtection.feeType === "percent") {
      amount = Math.round(
        (appointment.servicePrice * appointment.noShowProtection.feeAmount) / 100
      );
    } else {
      amount = appointment.noShowProtection.feeAmount;
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid no-show amount" });
    }

    /**
     * 3️⃣ Load customer + barber
     */
    const customerSnap = await db
      .collection("users")
      .doc(appointment.customerId)
      .get();

    const barberSnap = await db
      .collection("users")
      .doc(appointment.barberId)
      .get();

    if (!customerSnap.exists || !barberSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const customer = customerSnap.data();
    const barber = barberSnap.data();

    if (!customer.stripeCustomerId || !customer.defaultPaymentMethodId) {
      return res.status(400).json({ error: "Customer missing payment method" });
    }

    if (!barber.stripeAccountId) {
      return res.status(400).json({ error: "Barber not connected to Stripe" });
    }

    /**
     * 4️⃣ Create PaymentIntent (off-session)
     */
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amount * 100, // cents
        currency: "usd",
        customer: customer.stripeCustomerId,
        payment_method: customer.defaultPaymentMethodId,
        off_session: true,
        confirm: true,
        description: "No-show fee",
        metadata: {
          appointmentId,
          barberId: appointment.barberId,
          customerId: appointment.customerId,
        },
      },
      {
        stripeAccount: barber.stripeAccountId,
      }
    );

    /**
     * 5️⃣ Mark appointment as charged (idempotent)
     */
    await apptRef.update({
      "noShowProtection.status": "charged",
      "noShowProtection.chargedAt":
        admin.firestore.FieldValue.serverTimestamp(),
      "noShowProtection.paymentIntentId": paymentIntent.id,
    });

    console.log("💸 No-show charged:", paymentIntent.id);

    return res.status(200).json({
      success: true,
      paymentIntentId: paymentIntent.id,
      amountCharged: amount,
    });
  } catch (err) {
    console.error("❌ No-show charge failed:", err);

    return res.status(500).json({
      error: "Failed to charge no-show",
      details: err.message,
    });
  }
}
