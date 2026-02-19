// api/sms-reply.js

import admin from "firebase-admin";
import { adminDb } from "./_firebaseAdmin.js";

// ---- Handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const from = req.body.From;
    const body = req.body.Body?.trim().toUpperCase();

    if (!from || !body) {
      return res.status(400).send("Invalid request");
    }

    const snapshot = await adminDb
      .collection("appointments")
      .where("customerPhone", "==", from)
      .where("status", "==", "scheduled")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return sendTwilioResponse(
        res,
        "We couldn’t find an active appointment for this number."
      );
    }

    const docSnap = snapshot.docs[0];
    const apptRef = adminDb.collection("appointments").doc(docSnap.id);

    if (body === "YES") {
      await apptRef.update({
        status: "confirmed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return sendTwilioResponse(
        res,
        "✅ Your appointment is confirmed. See you soon!"
      );
    }

    if (body === "NO") {
      await apptRef.update({
        status: "cancelled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return sendTwilioResponse(
        res,
        "❌ Your appointment has been cancelled."
      );
    }

    return sendTwilioResponse(
      res,
      "Please reply YES to confirm or NO to cancel your appointment."
    );
  } catch (err) {
    console.error("SMS WEBHOOK ERROR:", err);
    return res.status(500).send("Server error");
  }
}

// ---- Twilio XML ----
function sendTwilioResponse(res, message) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(
    `<Response><Message>${message}</Message></Response>`
  );
}
