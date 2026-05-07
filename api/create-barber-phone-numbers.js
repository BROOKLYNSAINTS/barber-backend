import twilio from "twilio";
import { getAdminDb } from "./_firebaseAdmin.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;

export default async function handler(req, res) {
  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const { barberId, zipcode } = req.body;

    if (!barberId) {
      return res.status(400).json({ error: "Missing barberId" });
    }

    const API_BASE =
      process.env.PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL;

    const VOICE_BASE =
      process.env.VOICE_WEBHOOK_BASE_URL || API_BASE;

    if (!API_BASE) {
      throw new Error("Missing PUBLIC_API_BASE_URL");
    }

    // ✅ prevent duplicate provisioning
    const userRef = db.collection("users").doc(barberId);
    const snap = await userRef.get();

    if (snap.exists && snap.data()?.twilioPhoneNumber) {
      return res.json({ success: true, message: "Already provisioned" });
    }

    // ✅ derive area code safely
    const areaCode =
      zipcode && zipcode.length >= 3
        ? zipcode.substring(0, 3)
        : "718";

    // 🔍 find available number
    const numbers = await client.availablePhoneNumbers("US")
      .local
      .list({ areaCode, limit: 1 });

    if (!numbers.length) {
      throw new Error("No numbers available");
    }

    const selectedNumber = numbers[0].phoneNumber;

    // 📞 purchase number
    const incoming = await client.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,
      voiceUrl: `${VOICE_BASE}/api/voice`,
      voiceMethod: "POST",
      smsUrl: `${API_BASE}/api/sms-reply`,
      smsMethod: "POST",
    });

    // 🚨 attach to messaging service (A2P compliance)
    if (MESSAGING_SERVICE_SID) {
      try {
        await client.messaging
          .services(MESSAGING_SERVICE_SID)
          .phoneNumbers
          .create({
            phoneNumberSid: incoming.sid,
          });
      } catch (err) {
        console.error("Failed to attach to Messaging Service:", err);
      }
    } else {
      console.warn("TWILIO_MESSAGING_SERVICE_SID is missing");
    }

    // 💾 save to Firestore
    await userRef.update({
      twilioPhoneNumber: incoming.phoneNumber,
      twilioPhoneNumberSid: incoming.sid,
      twilioProvisionedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      number: incoming.phoneNumber,
    });

  } catch (err) {
    console.error("Provisioning error:", err);
    return res.status(500).json({ error: "Provision failed" });
  }
}
