import { db } from "./firebase"; // adjust path if needed
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";

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

    // Find the most recent scheduled appointment for this phone number
    const q = query(
      collection(db, "appointments"),
      where("customerPhone", "==", from),
      where("status", "==", "scheduled")
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return sendTwilioResponse(
        res,
        "We couldn’t find an active appointment for this number."
      );
    }

    // Use the most recent appointment
    const snap = snapshot.docs[0];
    const apptRef = doc(db, "appointments", snap.id);

    if (body === "YES") {
      await updateDoc(apptRef, {
        status: "confirmed",
        updatedAt: new Date()
      });

      return sendTwilioResponse(
        res,
        "✅ Your appointment is confirmed. See you soon!"
      );
    }

    if (body === "NO") {
      await updateDoc(apptRef, {
        status: "cancelled",
        updatedAt: new Date()
      });

      return sendTwilioResponse(
        res,
        "❌ Your appointment has been cancelled. Reply RESCHEDULE if you'd like to book another time."
      );
    }

    // Fallback (non YES/NO)
    return sendTwilioResponse(
      res,
      "Please reply YES to confirm or NO to cancel your appointment."
    );
  } catch (error) {
    console.error("SMS WEBHOOK ERROR:", error);
    return res.status(500).send("Server error");
  }
}

// Twilio requires valid TwiML XML
function sendTwilioResponse(res, message) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(`
    <Response>
      <Message>${message}</Message>
    </Response>
  `);
}
