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

/* ==============================
   CRON HANDLER
============================== */

export default async function handler(req, res) {
  try {
    console.log("🔔 Running send-reminders cron");

    const now = new Date();
    const in15Minutes = new Date(now.getTime() + 15 * 60 * 1000);

    let remindersSent = 0;

    const snapshot = await db
      .collection("appointments")
      .where("status", "==", "confirmed")       // ✅ FIXED
      .where("paymentStatus", "==", "paid")    // ✅ Only paid appointments
      .get();

    console.log("📊 Appointments fetched:", snapshot.size);

    for (const doc of snapshot.docs) {
      const appt = doc.data();

      if (appt.reminderSent === true) continue;

      if (!appt.startTime) continue;

      const appointmentTime =
        appt.startTime?.toDate?.() ||
        new Date(appt.startTime);

      if (appointmentTime >= now && appointmentTime <= in15Minutes) {

        if (!appt.customerPhone || !process.env.TWILIO_PHONE_NUMBER) {
          console.log("⚠️ Missing phone number");
          continue;
        }

        await client.messages.create({
          body: `Reminder: You have an appointment at ${appointmentTime.toLocaleTimeString()}`,
          from: process.env.TWILIO_PHONE_NUMBER,  // ✅ safer than barberPhone
          to: appt.customerPhone,
        });

        await doc.ref.update({
          reminderSent: true,
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        remindersSent++;
        console.log("✅ Reminder sent to:", appt.customerPhone);
      }
    }

    console.log("🎯 Reminders sent:", remindersSent);

    return res.status(200).json({
      success: true,
      remindersSent,
    });

  } catch (err) {
    console.error("❌ CRON ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}