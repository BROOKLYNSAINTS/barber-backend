import twilio from "twilio";
import OpenAI from "openai";

import { getAdminDb } from "./_firebaseAdmin.js";
import { FirestoreAppointmentProvider } from "../lib/FirestoreAppointmentProvider.js";
import { getBarberByPhone } from "../lib/barber.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SESSIONS = new Map();
const VERIFY_CODES = new Map();

const VOICE = "Google.en-US-Wavenet-F";

const provider =
  new FirestoreAppointmentProvider();

const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

function sendTwiml(res, twiml) {

  res.setHeader(
    "Content-Type",
    "text/xml"
  );

  res.status(200).send(
    twiml.toString()
  );
}

function buildGather(twiml) {

  return twiml.gather({
    input: "speech",
    enhanced: true,
    speechModel: "phone_call",
    language: "en-US",
    speechTimeout: "auto",
    action: "/api/voice",
    method: "POST",
  });
}

function speakAndListen(
  twiml,
  message
) {

  const gather =
    buildGather(twiml);

  gather.say(
    { voice: VOICE },
    message
  );

  return twiml;
}

function resolveDate(input) {

  const today = new Date();

  if (!input) {
    return today
      .toISOString()
      .split("T")[0];
  }

  const lower =
    String(input).toLowerCase();

  if (lower === "tomorrow") {

    today.setDate(
      today.getDate() + 1
    );

    return today
      .toISOString()
      .split("T")[0];
  }

  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const targetDay =
    days.indexOf(lower);

  if (targetDay >= 0) {

    const currentDay =
      today.getDay();

    let diff =
      targetDay - currentDay;

    if (diff <= 0) {
      diff += 7;
    }

    today.setDate(
      today.getDate() + diff
    );

    return today
      .toISOString()
      .split("T")[0];
  }

  return input;
}

function normalizeTime(input) {

  if (!input) return null;

  let text =
    String(input)
      .toLowerCase()
      .trim();

  const hasAM =
    text.includes("am");

  const hasPM =
    text.includes("pm");

  text = text
    .replace(/am|pm/g, "")
    .trim();

  let hour = 0;
  let minute = "00";

  if (text.includes(":")) {

    const parts =
      text.split(":");

    hour =
      parseInt(parts[0], 10);

    minute =
      parts[1] || "00";

  } else {

    hour =
      parseInt(text, 10);
  }

  if (isNaN(hour)) {
    return input;
  }

  if (!hasAM && !hasPM) {

    if (
      hour >= 1 &&
      hour <= 7
    ) {
      text += " PM";
    } else {
      text += " AM";
    }

  } else if (hasPM) {

    text += " PM";

  } else {

    text += " AM";
  }

  return `${hour}:${minute} ${
    text.includes("PM")
      ? "PM"
      : "AM"
  }`;
}

export default async function handler(
  req,
  res
) {

  const db =
    getAdminDb(req.headers.host);

  const twiml =
    new twilio.twiml.VoiceResponse();

  try {

    const params = {
      ...(req.query || {}),
      ...(req.body || {}),
    };

    const toNumber =
      params.To ||
      params.Called ||
      "";

    const callerPhone =
      params.From ||
      params.Caller ||
      "";

    console.log(
      "VOICE METHOD:",
      req.method
    );

    console.log(
      "VOICE TO:",
      toNumber
    );

    console.log(
      "VOICE FROM:",
      callerPhone
    );

    if (
      !SESSIONS.has(callerPhone)
    ) {

      SESSIONS.set(
        callerPhone,
        {
          service: null,
          date: null,
          time: null,
          verified: false,
          confirming: false,
          awaitingCode: false,
        }
      );
    }

    const session =
      SESSIONS.get(callerPhone);

    const barber =
      await getBarberByPhone(
        toNumber,
        req.headers.host
      );

    if (!barber) {

      twiml.say(
        { voice: VOICE },
        "Sorry, barber not found."
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    const shopName =
      barber.name ||
      "the barber shop";

    const servicesSnap =
      await db
        .collection("users")
        .doc(barber.id)
        .collection("services")
        .get();

    const services =
      servicesSnap.docs.map(
        (d) => ({
          id: d.id,
          ...d.data(),
        })
      );

    if (!params.SpeechResult) {

      speakAndListen(
        twiml,
        `Hi, thank you for calling ${shopName}. How can I help you today?`
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    const userText =
      String(
        params.SpeechResult || ""
      )
        .trim()
        .toLowerCase();

    console.log(
      "USER SAID:",
      userText
    );

    // ✅ FIXED CUSTOMER LOOKUP

    const normalizedPhone =
      callerPhone.replace(/\D/g, "");

    const possiblePhones = [
      callerPhone,
      normalizedPhone,
      `+${normalizedPhone}`,
    ];

    let userDoc = null;

    for (const phone of possiblePhones) {

      const snap = await db
        .collection("users")
        .where("role", "==", "customer")
        .where("phone", "==", phone)
        .limit(1)
        .get();

      if (!snap.empty) {

        userDoc =
          snap.docs[0];

        break;
      }
    }

    console.log(
      "CUSTOMER FOUND:",
      !!userDoc
    );

    if (!userDoc) {

      twiml.say(
        { voice: VOICE },
        "Please create an account in the app first."
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    const user =
      userDoc.data();

    console.log(
      "USER DATA:",
      JSON.stringify(user)
    );

    console.log(
      "DEFAULT PAYMENT METHOD:",
      user.defaultPaymentMethodId
    );

    const paymentMethodId =
      user.defaultPaymentMethodId ||
      user.customerStripePaymentMethodId;

    console.log(
      "FINAL PAYMENT METHOD:",
      paymentMethodId
    );

    if (
      !paymentMethodId ||
      paymentMethodId === "ok"
    ) {

      twiml.say(
        { voice: VOICE },
        "Please add a payment method in the app."
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (!session.verified) {

      if (
        !session.awaitingCode
      ) {

        const code =
          Math.floor(
            100000 +
            Math.random() *
            900000
          ).toString();

        VERIFY_CODES.set(
          callerPhone,
          code
        );

        session.awaitingCode =
          true;

        console.log(
          "VERIFICATION CODE:",
          code
        );

        await smsClient.messages.create({
          body: `Your verification code is ${code}`,
          from: process.env.TWILIO_VERIFIED_SMS_NUMBER,
          to: callerPhone,
        });
        speakAndListen(
          twiml,
          "I sent a six digit verification code to your phone. Please say the code."
        );

        return sendTwiml(
          res,
          twiml
        );
      }

      const expectedCode =
        VERIFY_CODES.get(
          callerPhone
        );

      const cleanedSpeech =
        userText.replace(
          /\D/g,
          ""
        );

      if (
        cleanedSpeech !==
        expectedCode
      ) {

        speakAndListen(
          twiml,
          "Incorrect code. Please try again."
        );

        return sendTwiml(
          res,
          twiml
        );
      }

      VERIFY_CODES.delete(
        callerPhone
      );

      session.verified =
        true;

      session.awaitingCode =
        false;

      speakAndListen(
        twiml,
        "You're verified. What service would you like?"
      );

      return sendTwiml(
        res,
        twiml
      );
    }

let serviceMatch =
  services.find((s) =>
    userText.includes(
      String(
        s.name || ""
      ).toLowerCase()
    )
  );

// 🔥 IMPROVED MATCHING
if (!serviceMatch) {

  serviceMatch =
    services.find((s) => {

      const serviceName =
        String(
          s.name || ""
        )
          .toLowerCase()
          .trim();

      return (
        serviceName.includes(userText) ||
        userText.includes(serviceName)
      );
    });
}

// 🔥 HANDLE BAD SPEECH RECOGNITION
if (!serviceMatch && services.length > 0) {

  const serviceNames =
    services
      .map((s) => s.name)
      .join(", ");

  speakAndListen(
    twiml,
    `I didn't catch the service. Available services are ${serviceNames}. Please say the service again.`
  );

  return sendTwiml(
    res,
    twiml
  );
}

if (serviceMatch) {

  session.service =
    serviceMatch;

  console.log(
    "SERVICE MATCH:",
    session.service.name
  );
}
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];

    if (
      userText.includes(
        "tomorrow"
      )
    ) {
      session.date =
        "tomorrow";
    }

    const foundDay =
      days.find((day) =>
        userText.includes(day)
      );

    if (foundDay) {
      session.date =
        foundDay;
    }

    const timeMatch =
      userText.match(
        /\b\d{1,2}(:\d{2})?\s?(am|pm)?\b/
      );

    if (timeMatch) {

      session.time =
        normalizeTime(
          timeMatch[0]
        );
    }

    if (!session.service) {

      speakAndListen(
        twiml,
        "What service would you like?"
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (!session.date) {

      speakAndListen(
        twiml,
        "What day would you like?"
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (!session.time) {

      speakAndListen(
        twiml,
        "What time works for you?"
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (!session.confirming) {

      session.confirming =
        true;

      speakAndListen(
        twiml,
        `Confirm booking: ${session.service.name}, ${session.date}, ${session.time}. Say yes to confirm or no to cancel.`
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (
      userText.includes(
        "yes"
      ) ||
      userText.includes(
        "yeah"
      ) ||
      userText.includes(
        "correct"
      ) ||
      userText.includes(
        "right"
      )
    ) {

      const normalizedDate =
        resolveDate(
          session.date
        );

      const appointment =
        await provider.createAppointment({

          barberId:
            barber.id,

          barberName:
            barber.name,

          barberPhone:
            barber.phone,

          customerId:
            userDoc.id,

          customerName:
            user.name,

          customerPhone:
            callerPhone,

          serviceId:
            session.service.id,

          serviceName:
            session.service.name,

          servicePrice:
            session.service.price || 0,

          date:
            normalizedDate,

          time:
            session.time,
        });

      session.confirming =
        false;

      if (appointment.ok) {

        twiml.say(
          { voice: VOICE },
          `You're booked for ${normalizedDate} at ${session.time}`
        );

        return sendTwiml(
          res,
          twiml
        );
      }

      twiml.say(
        { voice: VOICE },
        appointment.message ||
        "Unable to book appointment."
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    if (
      userText.includes("no")
    ) {

      session.confirming =
        false;

      speakAndListen(
        twiml,
        "Booking cancelled."
      );

      return sendTwiml(
        res,
        twiml
      );
    }

    speakAndListen(
      twiml,
      "Please say yes or no."
    );

    return sendTwiml(
      res,
      twiml
    );

  } catch (err) {

    console.error(err);

    twiml.say(
      { voice: VOICE },
      "Something went wrong."
    );

    return sendTwiml(
      res,
      twiml
    );
  }
}