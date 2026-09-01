// api/vapi.js

import { getAdminDb } from "./_firebaseAdmin.js";
import { FirestoreAppointmentProvider } from "../lib/FirestoreAppointmentProvider.js";
import { getBarberByPhone } from "../lib/barber.js";

const provider = new FirestoreAppointmentProvider();

function normalizePhoneVariants(phoneNumber = "") {
  const normalized = String(phoneNumber).replace(/\D/g, "");

  return [
    phoneNumber,
    normalized,
    normalized ? `+${normalized}` : "",
  ].filter(Boolean);
}

async function checkCustomerStatus(db, phoneNumber) {
  const possiblePhones = normalizePhoneVariants(phoneNumber);

  let userDoc = null;

  for (const phone of possiblePhones) {
    const snap = await db
      .collection("users")
      .where("role", "==", "customer")
      .where("phone", "==", phone)
      .limit(1)
      .get();

    if (!snap.empty) {
      userDoc = snap.docs[0];
      break;
    }
  }

  if (!userDoc) {
    return {
      success: true,
      customerExists: false,
      canContinue: false,
      reason: "CUSTOMER_NOT_FOUND",
      message: "Please create an account in the mobile app first.",
    };
  }

  const user = userDoc.data();

  const paymentMethodId =
    user.defaultPaymentMethodId ||
    user.customerStripePaymentMethodId;

  const hasPaymentMethod =
    !!paymentMethodId &&
    paymentMethodId !== "ok";

  return {
    success: true,
    customerExists: true,
    customerId: userDoc.id,
    customerName: user.name || "",
    customerPhone: user.phone || phoneNumber,
    stripeCustomerId: user.stripeCustomerId || null,
    defaultPaymentMethodId: paymentMethodId || null,
    hasPaymentMethod,
    canContinue: hasPaymentMethod,
    reason: hasPaymentMethod ? "OK" : "NO_PAYMENT_METHOD",
    message: hasPaymentMethod
      ? "Customer found and has a payment method on file."
      : "Please add a payment method in the mobile app before booking.",
  };
}

async function getBarberContext(db, calledNumber, host) {
  const barber = await getBarberByPhone(calledNumber, host);

  if (!barber) {
    return {
      success: false,
      barberExists: false,
      message: "Sorry, barber not found.",
    };
  }

  const servicesSnap = await db
    .collection("users")
    .doc(barber.id)
    .collection("services")
    .get();

  const services = servicesSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return {
    success: true,
    barberExists: true,
    barber: {
      id: barber.id,
      name: barber.name || "the barber shop",
      phone: barber.phone || calledNumber,
    },
    services,
  };
}

function findServiceMatch(services, requestedService) {
  const text = String(requestedService || "")
    .toLowerCase()
    .trim();

  if (!text) return null;

  return (
    services.find((service) =>
      text.includes(String(service.name || "").toLowerCase())
    ) ||
    services.find((service) => {
      const serviceName = String(service.name || "")
        .toLowerCase()
        .trim();

      return (
        serviceName.includes(text) ||
        text.includes(serviceName)
      );
    }) ||
    null
  );
}

function resolveDate(input) {
  const today = new Date();

  if (!input) {
    return today.toISOString().split("T")[0];
  }

  const lower = String(input).toLowerCase().trim();

  if (lower === "tomorrow") {
    today.setDate(today.getDate() + 1);
    return today.toISOString().split("T")[0];
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

  const targetDay = days.indexOf(lower);

  if (targetDay >= 0) {
    const currentDay = today.getDay();
    let diff = targetDay - currentDay;

    if (diff <= 0) diff += 7;

    today.setDate(today.getDate() + diff);
    return today.toISOString().split("T")[0];
  }

  return input;
}

async function createAppointmentFromVapi({
  db,
  host,
  callerPhone,
  calledNumber,
  serviceName,
  date,
  time,
}) {
  const customer = await checkCustomerStatus(db, callerPhone);

  if (!customer.customerExists) return customer;

  if (!customer.hasPaymentMethod) return customer;

  const barberContext = await getBarberContext(db, calledNumber, host);

  if (!barberContext.barberExists) return barberContext;

  const service = findServiceMatch(
    barberContext.services,
    serviceName
  );

  if (!service) {
    return {
      success: false,
      reason: "SERVICE_NOT_FOUND",
      message: `I could not match that service. Available services are: ${barberContext.services
        .map((s) => s.name)
        .join(", ")}.`,
      services: barberContext.services,
    };
  }

  const normalizedDate = resolveDate(date);

  const appointment = await provider.createAppointment({
    barberId: barberContext.barber.id,
    barberName: barberContext.barber.name,
    barberPhone: barberContext.barber.phone,

    customerId: customer.customerId,
    customerName: customer.customerName,
    customerPhone: callerPhone,

    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price || 0,

    date: normalizedDate,
    time,
  });

  return {
    success: !!appointment.ok,
    appointment,
    message: appointment.ok
      ? `Appointment booked for ${normalizedDate} at ${time}.`
      : appointment.message || "Unable to book appointment.",
  };
}

function getVapiNumbers(message) {
  const callerPhone =
    message?.customer?.number ||
    message?.call?.customer?.number ||
    message?.artifact?.variables?.customer?.number ||
    message?.artifact?.variableValues?.customer?.number ||
    "";

  const calledNumber =
    message?.phoneNumber?.number ||
    message?.call?.phoneNumber?.number ||
    message?.artifact?.variables?.phoneNumber?.number ||
    message?.artifact?.variableValues?.phoneNumber?.number ||
    "";

  return {
    callerPhone,
    calledNumber,
  };
}

async function handleToolCalls({ req, res, db, message }) {
  const toolCalls =
    message.toolCalls ||
    message.toolCallList ||
    message.tool_calls ||
    [];

  const results = [];

  for (const toolCall of toolCalls) {
    const toolName =
      toolCall?.function?.name ||
      toolCall?.name ||
      toolCall?.toolName;

    const args =
      toolCall?.function?.arguments ||
      toolCall?.arguments ||
      toolCall?.args ||
      {};

    let parsedArgs = args;

    if (typeof args === "string") {
      try {
        parsedArgs = JSON.parse(args);
      } catch {
        parsedArgs = {};
      }
    }

    const { callerPhone, calledNumber } = getVapiNumbers(message);

    let result;

    if (toolName === "checkCustomerStatus") {
      result = await checkCustomerStatus(
        db,
        parsedArgs.phoneNumber || callerPhone
      );
    } else if (toolName === "getBarberContext") {
      result = await getBarberContext(
        db,
        parsedArgs.calledNumber || calledNumber,
        req.headers.host
      );
    } else if (toolName === "createAppointment") {
      result = await createAppointmentFromVapi({
        db,
        host: req.headers.host,
        callerPhone: parsedArgs.phoneNumber || callerPhone,
        calledNumber: parsedArgs.calledNumber || calledNumber,
        serviceName: parsedArgs.serviceName,
        date: parsedArgs.date,
        time: parsedArgs.time,
      });
    } else {
      result = {
        success: false,
        message: `Unknown tool: ${toolName}`,
      };
    }

    results.push({
      toolCallId: toolCall.id,
      result,
    });
  }

  return res.status(200).json({
    results,
  });
}

export default async function handler(req, res) {
  try {
    const db = getAdminDb(req.headers.host);

    console.log(
      "VAPI SERVER HIT:",
      JSON.stringify(req.body, null, 2)
    );

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
    }

    const message = req.body?.message || {};
    const type = message.type;

    console.log("VAPI MESSAGE TYPE:", type);

    if (type === "assistant-request") {
      return res.status(200).json({
        assistantId: process.env.VAPI_ASSISTANT_ID,
      });
    }

    if (type === "tool-calls") {
      return handleToolCalls({
        req,
        res,
        db,
        message,
      });
    }

    if (type === "end-of-call-report") {
      console.log("CALL SUMMARY:", message.summary || "");
      console.log("CALL TRANSCRIPT:", message.transcript || "");

      return res.status(200).json({
        received: true,
      });
    }

    return res.status(200).json({
      received: true,
      type,
    });
  } catch (error) {
    console.error("VAPI SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}