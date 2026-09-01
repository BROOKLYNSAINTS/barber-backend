import twilio from "twilio";
import { getAdminDb } from "./_firebaseAdmin.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;

export default async function handler(req, res) {
  try {
    // ✅ DB
    const db = getAdminDb(req.headers.host);

    const { barberId } = req.body;

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
      return res.json({
        success: true,
        message: "Already provisioned",
      });
    }

    // 🔥 GET AVAILABLE TOLL FREE NUMBER
    const numbers = await client.availablePhoneNumbers("US")
      .tollFree
      .list({ limit: 1 });

    if (!numbers.length) {
      throw new Error("No toll-free numbers available");
    }

    const selectedNumber = numbers[0].phoneNumber;

    // 📞 PURCHASE NUMBER
    const incoming = await client.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,

      voiceUrl: `${VOICE_BASE}/api/voice`,
      voiceMethod: "POST",

      smsUrl: `${API_BASE}/api/sms-reply`,
      smsMethod: "POST",
    });

    // ✅ attach to messaging service
    if (MESSAGING_SERVICE_SID) {
      try {
        await client.messaging
          .services(MESSAGING_SERVICE_SID)
          .phoneNumbers
          .create({
            phoneNumberSid: incoming.sid,
          });
      } catch (err) {
        console.error(
          "Failed to attach to Messaging Service:",
          err
        );
      }
    } else {
      console.warn(
        "TWILIO_MESSAGING_SERVICE_SID is missing"
      );
    }

    // 💾 SAVE TO FIRESTORE
    await userRef.update({
      twilioPhoneNumber: incoming.phoneNumber,
      twilioPhoneNumberSid: incoming.sid,
      twilioProvisionedAt: new Date().toISOString(),
      twilioNumberType: "toll-free",
    });

    return res.json({
      success: true,
      number: incoming.phoneNumber,
      type: "toll-free",
    });

  } catch (err) {
    console.error("Provisioning error:", err);

    return res.status(500).json({
      error: err?.message || "Provision failed",
    });
  }
}