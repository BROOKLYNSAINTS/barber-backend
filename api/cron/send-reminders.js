import twilio from "twilio";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// ---------- Firebase Admin init ----------
if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

// ---------- Twilio ----------
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  try {
    const now = new Date();

    /* ===========================
       TEST WINDOW (ACTIVE)
       =========================== */
    const startWindow = new Date(now.getTime() + 1 * 60 * 1000); // +1 min
    const endWindow   = new Date(now.getTime() + 3 * 60 * 1000); // +3 min

    /* ===========================
       PRODUCTION WINDOW (24h)
       ===========================
    const startWindow = new Date(now.getTime() + 23.75 * 60 * 60 * 1000);
    const endWindow   = new Date(now.getTime() + 24.25 * 60 * 60 * 1000);
    =========================== */

    const snapshot = await db
      .collection("appointments")
      .where("status", "==", "scheduled")
      .where("reminderSent", "!=", true)
      .get();

    let sent = 0;

    for (const docSnap of snapshot.docs) {
      const appt = docSnap.data();

      if (!appt.start || !appt.customerPhone) continue;

      const appointmentTime = new Date(appt.start);

      if (
        appointmentTime >= startWindow &&
        appointmentTime <= endWindow
      ) {
        const timeString = appointmentTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit"
        });

        const message = `Hi ${appt.customerName} 👋
Reminder: You have a ${appt.serviceName} scheduled at ${timeString} with ${appt.barberName}.

Reply YES to confirm
Reply NO to cancel`;

        await client.messages.create({
          to: appt.customerPhone,
          from: process.env.TWILIO_PHONE_NUMBER,
          body: message
        });

        await docSnap.ref.update({
          reminderSent: true,
          reminderSentAt: Timestamp.now()
        });

        sent++;
      }
    }

    return res.status(200).json({
      success: true,
      remindersSent: sent
    });
  } catch (err) {
    console.error("REMINDER CRON ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
