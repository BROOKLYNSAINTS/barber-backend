import Stripe from "stripe";
import admin, { adminDb } from "../_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  // 🔒 Optional: protect cron with secret
  const cronSecret = req.headers["x-cron-secret"];
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const snap = await adminDb
      .collection("appointments")
      .where("status", "==", "late_cancel")
      .where("noShowProtection.status", "==", "pending_charge")
      .get();

    let chargedCount = 0;

    for (const doc of snap.docs) {
      const appt = doc.data();
      const appointmentRef = doc.ref;

      try {
        if (
          !appt.customerStripeId ||
          !appt.customerStripePaymentMethodId ||
          !appt.barberStripeAccountId
        ) {
          console.warn("Skipping – missing Stripe data", doc.id);
          continue;
        }

        const ns = appt.noShowProtection || {};
        let amountCents = 0;

        if (ns.feeType === "percent") {
          amountCents = Math.round(
            ((appt.servicePrice || 0) * (ns.feeAmount || 0)) / 100 * 100
          );
        } else {
          amountCents = Math.round((ns.feeAmount || 0) * 100);
        }

        if (!amountCents || amountCents <= 0) continue;

        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: "usd",
            customer: appt.customerStripeId,
            payment_method: appt.customerStripePaymentMethodId,
            off_session: true,
            confirm: true,
            description: `Late cancellation fee – ${appt.serviceName}`,
            metadata: {
              appointmentId: doc.id,
              barberId: appt.barberId,
              customerId: appt.customerId,
            },
          },
          {
            stripeAccount: appt.barberStripeAccountId,
          }
        );

        await adminDb.runTransaction(async (tx) => {
          tx.update(appointmentRef, {
            status: "no_show",
            paymentStatus: "charged",
            noShowProtection: {
              ...ns,
              status: "charged",
              amountCharged: amountCents / 100,
              paymentIntentId: paymentIntent.id,
              chargedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.set(
            adminDb.collection("users").doc(appt.barberId),
            {
              metrics: {
                recoveredRevenue:
                  admin.firestore.FieldValue.increment(
                    amountCents / 100
                  ),
              },
            },
            { merge: true }
          );
        });

        chargedCount++;
      } catch (err) {
        console.error(`❌ Failed charging ${doc.id}`, err.message);
      }
    }

    return res.json({
      success: true,
      chargedCount,
    });
  } catch (err) {
    console.error("❌ Cron failed:", err);
    return res.status(500).json({ error: "Cron failed" });
  }
}
