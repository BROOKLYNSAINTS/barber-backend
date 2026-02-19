import Stripe from "stripe";
import admin, { adminDb } from "../_firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  try {
    // 🔒 Optional cron auth
    if (
      process.env.CRON_SECRET &&
      req.headers["x-cron-secret"] !== process.env.CRON_SECRET
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const snap = await adminDb
      .collection("appointments")
      .where("noShowProtection.status", "==", "pending_charge")
      .limit(25)
      .get();

    let charged = 0;

    for (const doc of snap.docs) {
      const appt = doc.data();

      try {
        if (
          !appt.customerStripeId ||
          !appt.customerStripePaymentMethodId ||
          !appt.barberStripeAccountId
        ) {
          await doc.ref.update({
            "noShowProtection.status": "failed",
            "noShowProtection.lastError": "Missing Stripe linkage",
          });
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

        if (!amountCents || amountCents <= 0) {
          await doc.ref.update({
            "noShowProtection.status": "waived",
          });
          continue;
        }

        const intent = await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: "usd",
            customer: appt.customerStripeId,
            payment_method: appt.customerStripePaymentMethodId,
            off_session: true,
            confirm: true,
            description: "Late cancellation fee",
            metadata: {
              appointmentId: doc.id,
              type: "late_cancel",
            },
          },
          {
            stripeAccount: appt.barberStripeAccountId,
          }
        );

        await doc.ref.update({
          status: "late_cancel_charged",
          "noShowProtection.status": "charged",
          "noShowProtection.amountCharged": amountCents / 100,
          "noShowProtection.paymentIntentId": intent.id,
          chargedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await adminDb
          .collection("users")
          .doc(appt.barberId)
          .set(
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

        charged++;
      } catch (err) {
        console.error(`❌ Charge failed for ${doc.id}`, err.message);

        await doc.ref.update({
          "noShowProtection.status": "failed",
          "noShowProtection.lastError": err.message,
        });
      }
    }

    return res.json({ success: true, charged });
  } catch (err) {
    console.error("❌ Cron failed:", err);
    return res.status(500).json({ error: "Cron failed" });
  }
}
