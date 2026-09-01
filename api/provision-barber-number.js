import twilio from "twilio";
import { getAdminDb } from "./_firebaseAdmin.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MESSAGING_SERVICE_SID =
  process.env.TWILIO_MESSAGING_SERVICE_SID;

export default async function handler(req, res) {
  try {
    // ✅ DB
    const db = getAdminDb(req.headers.host);

    const { barberId } = req.body;

    if (!barberId) {
      return res.status(400).json({
        error: "Missing barberId",
      });
    }

    const API_BASE =
      process.env.PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL;

    const VOICE_BASE =
      process.env.VOICE_WEBHOOK_BASE_URL || API_BASE;

    if (!API_BASE) {
      throw new Error("Missing PUBLIC_API_BASE_URL");
    }

    const userRef = db.collection("users").doc(barberId);

    const snap = await userRef.get();

    // ✅ prevent duplicate provisioning
    if (snap.exists && snap.data()?.twilioPhoneNumber) {
      return res.json({
        success: true,
        message: "Already provisioned",
      });
    }

    // 🔥 FIND AVAILABLE NUMBER
const areaCodes = ["718", "347", "646"];

let selectedNumber = null;

for (const areaCode of areaCodes) {

  const numbers = await client
    .availablePhoneNumbers("US")
    .local
    .list({
      areaCode,
      limit: 1,
    });

  if (numbers.length > 0) {
    selectedNumber = numbers[0].phoneNumber;
    break;
  }
}

if (!selectedNumber) {
  return res.status(400).json({
    error: "No local numbers available",
  });
}

    // 📞 PURCHASE NUMBER
    const purchasedNumber =
      await client.incomingPhoneNumbers.create({
        phoneNumber: selectedNumber,

        voiceUrl: `${VOICE_BASE}/api/voice`,
        voiceMethod: "POST",

        smsUrl: `${API_BASE}/api/sms-reply`,
        smsMethod: "POST",
      });

    // ✅ ATTACH TO MESSAGING SERVICE
    if (MESSAGING_SERVICE_SID) {
      await client.messaging
        .services(MESSAGING_SERVICE_SID)
        .phoneNumbers
        .create({
          phoneNumberSid: purchasedNumber.sid,
        });
    } else {
      console.warn(
        "Missing TWILIO_MESSAGING_SERVICE_SID"
      );
    }

    // 💾 SAVE TO FIRESTORE
    await userRef.update({
      twilioPhoneNumber: purchasedNumber.phoneNumber,
      twilioPhoneNumberSid: purchasedNumber.sid,
      twilioProvisionedAt: new Date().toISOString(),
      twilioNumberType: "local",    });

    return res.json({
      success: true,
      number: purchasedNumber.phoneNumber,
    });

  } catch (error) {
    console.error("Provisioning error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Failed to create Twilio number",
    });
  }
}