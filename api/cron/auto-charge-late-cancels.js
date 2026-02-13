import admin from 'firebase-admin';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {
    // 🔒 Optional cron auth
    if (
      process.env.CRON_SECRET &&
      req.headers['x-cron-secret'] !== process.env.CRON_SECRET
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const snap = await db
      .collection('appointments')
      .where('noShowProtection.status', '==', 'pending_charge')
      .limit(25)
      .get();

    let charged = 0;

    for (const doc of snap.docs) {
      const appt = doc.data();

      try {
        const amount =
          appt.noShowProtection?.feeType === 'flat'
            ? appt.noShowProtection.flatFeeAmount
            : appt.servicePrice;

        if (!amount || amount <= 0) {
          await doc.ref.update({
            'noShowProtection.status': 'waived',
          });
          continue;
        }

        const intent = await stripe.paymentIntents.create(
          {
            amount: Math.round(amount * 100),
            currency: 'usd',
            customer: appt.customerStripeId,
            payment_method: appt.customerStripePaymentMethodId,
            off_session: true,
            confirm: true,
            description: `Late cancellation fee`,
            metadata: {
              appointmentId: doc.id,
              type: 'late_cancel',
            },
          },
          {
            stripeAccount: appt.barberStripeAccountId,
          }
        );

        await doc.ref.update({
          status: 'late_cancel_charged',
          'noShowProtection.status': 'charged',
          'noShowProtection.amountCharged': amount,
          'noShowProtection.paymentIntentId': intent.id,
          chargedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 📈 Recovered revenue
        await db
          .collection('users')
          .doc(appt.barberId)
          .update({
            recoveredRevenue: admin.firestore.FieldValue.increment(amount),
          });

        charged++;
      } catch (err) {
        console.error(`❌ Charge failed for ${doc.id}`, err.message);

        await doc.ref.update({
          'noShowProtection.status': 'failed',
          'noShowProtection.lastError': err.message,
        });
      }
    }

    return res.json({ success: true, charged });
  } catch (err) {
    console.error('❌ Cron failed:', err);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
