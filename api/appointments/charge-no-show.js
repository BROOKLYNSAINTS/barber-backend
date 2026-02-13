import Stripe from 'stripe';
import admin from 'firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin (safe for serverless)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* ----------------------------------
     * Auth (BARBER)
     * ---------------------------------- */
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = await admin.auth().verifyIdToken(token);
    const barberUserId = decoded.uid;

    const { appointmentId } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ error: 'Missing appointmentId' });
    }

    const appointmentRef = db.collection('appointments').doc(appointmentId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(appointmentRef);
      if (!snap.exists) {
        throw new Error('Appointment not found');
      }

      const appt = snap.data();

      /* ----------------------------------
       * SAFETY CHECKS
       * ---------------------------------- */
      if (appt.barberId !== barberUserId) {
        throw new Error('Not authorized');
      }

      if (appt.noShowProtection?.status === 'charged') {
        return {
          alreadyCharged: true,
          amountCharged: appt.noShowProtection.amountCharged || 0,
        };
      }

      if (
        !appt.customerStripeId ||
        !appt.customerStripePaymentMethodId
      ) {
        throw new Error('Customer has no saved payment method');
      }

      if (!appt.barberStripeAccountId) {
        throw new Error('Barber Stripe account not connected');
      }

      /* ----------------------------------
       * CALCULATE FEE
       * ---------------------------------- */
      const ns = appt.noShowProtection || {};
      let amountCents = 0;

      if (ns.feeType === 'percent') {
        amountCents = Math.round(
          ((appt.servicePrice || 0) * ns.feeAmount) / 100 * 100
        );
      } else {
        amountCents = Math.round((ns.feeAmount || 0) * 100);
      }

      if (amountCents <= 0) {
        throw new Error('Invalid no-show fee');
      }

      /* ----------------------------------
       * STRIPE CHARGE (CONNECTED ACCOUNT)
       * ---------------------------------- */
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: appt.customerStripeId,
          payment_method: appt.customerStripePaymentMethodId,
          off_session: true,
          confirm: true,
          description: `No-show fee – ${appt.serviceName}`,
          metadata: {
            appointmentId,
            barberId: appt.barberId,
            customerId: appt.customerId,
          },
        },
        {
          stripeAccount: appt.barberStripeAccountId,
        }
      );

      /* ----------------------------------
       * FIRESTORE UPDATES
       * ---------------------------------- */
      tx.update(appointmentRef, {
        status: 'no_show',
        paymentStatus: 'charged',
        noShowProtection: {
          ...ns,
          status: 'charged',
          amountCharged: amountCents / 100,
          paymentIntentId: paymentIntent.id,
          chargedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 📊 Recovered revenue (lifetime)
      tx.set(
        db.collection('users').doc(appt.barberId),
        {
          metrics: {
            recoveredRevenue:
              admin.firestore.FieldValue.increment(amountCents / 100),
          },
        },
        { merge: true }
      );

      return {
        alreadyCharged: false,
        amountCharged: amountCents / 100,
      };
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('❌ No-show charge failed:', err);
    return res.status(400).json({
      error: err.message || 'Charge failed',
    });
  }
}
