// api/sms-reply.js

import admin from "firebase-admin";
import { getAdminDb } from "./_firebaseAdmin.js";

function normalizePhone(phone) {
  if (!phone) return "";

  const digits = String(phone).replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  return digits;
}

function sendTwilioResponse(res, message) {
  res.setHeader("Content-Type", "text/xml");

  res.status(200).send(
    `<Response><Message>${message}</Message></Response>`
  );
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const raw = req.body || "";
  const params = new URLSearchParams(raw);

  const parsed = {};
  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }

  return parsed;
}

async function askAssistant({ message, from }) {
  const API_BASE =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!API_BASE) {
    throw new Error("Missing PUBLIC_API_BASE_URL");
  }

  const response = await fetch(`${API_BASE}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      from,
      channel: "sms",
    }),
  });

  const data = await response.json();

  return data.reply || "Sorry, I couldn't process that request.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    const parsedBody = parseBody(req);

    const from = parsedBody.From;
    const body = parsedBody.Body?.trim();

    if (!from || !body) {
      return res.status(400).send("Invalid request");
    }

    const normalizedPhone = normalizePhone(from);
    const upperBody = body.toUpperCase();

    console.log("Incoming SMS:", normalizedPhone, body);

    if (["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(upperBody)) {
      await db
        .collection("sms_opt_outs")
        .doc(normalizedPhone)
        .set({
          optedOut: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return sendTwilioResponse(
        res,
        "You have been unsubscribed and will no longer receive messages. Reply START to opt back in."
      );
    }

    if (["HELP", "INFO"].includes(upperBody)) {
      return sendTwilioResponse(
        res,
        "ScheduleSync AI: Appointment notifications. Reply STOP to unsubscribe."
      );
    }

    if (upperBody === "START") {
      await db
        .collection("sms_opt_outs")
        .doc(normalizedPhone)
        .set({
          optedOut: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return sendTwilioResponse(
        res,
        "You are now subscribed again and will receive appointment notifications."
      );
    }

    if (upperBody === "YES" || upperBody === "NO") {
      const snapshot = await db
        .collection("appointments")
        .where("customerPhone", "==", normalizedPhone)
        .where("status", "in", ["scheduled", "confirmed"])
        .orderBy("date", "asc")
        .limit(1)
        .get();

      if (snapshot.empty) {
        return sendTwilioResponse(
          res,
          "We couldn't find an upcoming appointment."
        );
      }

      const docSnap = snapshot.docs[0];
      const appointmentId = docSnap.id;

      const apptRef = db
        .collection("appointments")
        .doc(appointmentId);

      if (upperBody === "YES") {
        await apptRef.update({
          status: "confirmed",
          confirmationStatus: "confirmed",
          confirmationReceivedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

        return sendTwilioResponse(
          res,
          "✅ Your appointment is confirmed."
        );
      }

      if (upperBody === "NO") {
        await apptRef.update({
          status: "cancelled",
          cancelledBy: "customer_sms",
          cancelledAt:
            admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

        return sendTwilioResponse(
          res,
          "❌ Appointment cancelled."
        );
      }
    }

    const aiReply = await askAssistant({
      message: body,
      from: normalizedPhone,
    });

    return sendTwilioResponse(res, aiReply);

  } catch (err) {
    console.error("SMS WEBHOOK ERROR:", err);
    return res.status(500).send("Server error");
  }
}
