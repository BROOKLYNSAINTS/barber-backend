// api/cron/send-reminders.js
import twilio from "twilio";
import admin from "firebase-admin";

/* ==============================
   FIREBASE INIT
============================== */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

/* ==============================
   TWILIO INIT
============================== */
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;

/* ==============================
   HELPERS
============================== */

function normalizePhone(raw) {
  if (!raw) return null;

  const s = String(raw).trim();
  if (!s) return null;

  if (s.startsWith("+")) return s;

  const digits = s.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

/* ==============================
   CRON HANDLER
============================== */

export default async function handler(req, res) {
  try {
    console.log("🔔 Running send-reminders cron");

    const now = new Date();

    const windowMins = Number(process.env.REMINDER_WINDOW_MINUTES || 15);
    const windowEnd = new Date(now.getTime() + windowMins * 60 * 1000);

    console.log("⏰ Now:", now.toISOString());
    console.log("⏰ Window End:", windowEnd.toISOString());

    let remindersSent = 0;

    const snapshot = await db
      .collection("appointments")
      .where("status", "==", "confirmed")
      .get();

    console.log("📊 Appointments fetched:", snapshot.size);

    for (const docSnap of snapshot.docs) {
      const appt = docSnap.data() || {};

      if (appt.reminderSent === true) continue;
      if (appt.smsOptIn === false) continue;

      const appointmentTime = appt.startTime?.toDate?.();

      if (!appointmentTime) {
        console.log("⚠️ Missing startTime for", docSnap.id);
        continue;
      }

      if (!(appointmentTime >= now && appointmentTime <= windowEnd)) {
        continue;
      }

      const toPhone = normalizePhone(appt.customerPhone);

      if (!toPhone) {
        console.log("⚠️ Invalid customerPhone for", docSnap.id);
        continue;
      }

      const barberName = appt.barberName || "your barber";
      const serviceName = appt.serviceName || "your service";
      const timeDisplay =
        appt.time || appt.time24 || appointmentTime.toLocaleTimeString();

      const body =
        `Reminder: You have an appointment today at ${timeDisplay} with ${barberName} ` +
        `for ${serviceName}. Reply YES to confirm or NO to cancel.`;

      /* ==============================
         🚨 FIXED: SEND VIA MESSAGING SERVICE
      ============================== */

      await client.messages.create({
        body,
        messagingServiceSid: MESSAGING_SERVICE_SID,
        to: toPhone,
      });

      await docSnap.ref.update({
        reminderSent: true,
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      remindersSent++;

      console.log(
        "✅ Reminder sent for",
        docSnap.id,
        "to",
        toPhone
      );
    }

    console.log("🎯 Total reminders sent:", remindersSent);

    return res.status(200).json({
      success: true,
      remindersSent,
      windowMins,
    });
  } catch (err) {
    console.error("❌ CRON ERROR:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}