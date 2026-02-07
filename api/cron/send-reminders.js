import twilio from "twilio";
import { db } from "../firebase"; // adjust if needed
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  try {
    const now = new Date();

    /* =====================================================
       PRODUCTION LOGIC (24-HOUR WINDOW) — COMMENTED OUT
       =====================================================

    const startWindow = new Date(now.getTime() + 23.75 * 60 * 60 * 1000);
    const endWindow   = new Date(now.getTime() + 24.25 * 60 * 60 * 1000);

    ===================================================== */

    /* =====================================================
       TEST LOGIC (2-MINUTE WINDOW) — ACTIVE
       ===================================================== */

    const startWindow = new Date(now.getTime() + 1 * 60 * 1000); // +1 minute
    const endWindow   = new Date(now.getTime() + 3 * 60 * 1000); // +3 minutes

    /* ===================================================== */

    const snapshot = await getDocs(collection(db, "appointments"));

    let sent = 0;

    for (const snap of snapshot.docs) {
      const appt = snap.data();

      // Skip anything not eligible
      if (
        appt.status !== "scheduled" ||
        appt.reminderSent === true ||
        !appt.start ||
        !appt.customerPhone
      ) {
        continue;
      }

      // Build Date from "2025-12-17T01:00"
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

        await updateDoc(doc(db, "appointments", snap.id), {
          reminderSent: true
        });

        sent++;
      }
    }

    return res.status(200).json({
      success: true,
      remindersSent: sent
    });
  } catch (err) {
    console.error("Error sending reminders:", err);
    return res.status(500).json({ error: err.message });
  }
}
