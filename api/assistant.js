import OpenAI from "openai";
import { getAdminDb } from "./_firebaseAdmin.js";

import {
  getCustomerAppointments,
  getBarberAvailability,
  cancelAppointment,
  createAppointment,
  rescheduleAppointment
} from "./assistantActions.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function resolveCustomerFromEmail(db, email) {
  if (!email) return null;

  const snapshot = await db
    .collection("customers")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    customerId: doc.id,
    phone: data.phone || null
  };
}

async function getLastBarber(db, customerId) {
  if (!customerId) return null;

  const snapshot = await db
    .collection("appointments")
    .where("customerId", "==", customerId)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  return snapshot.docs[0].data().barberId || null;
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    let { message, from, barberId, channel, email } = req.body;
    let customerId = null;

    /*
    Resolve email → phone
    */

    if (!from && email) {

      const customer = await resolveCustomerFromEmail(db, email);

      if (customer) {
        from = customer.phone;
        customerId = customer.customerId;

        if (!barberId) {
          barberId = await getLastBarber(db, customerId);
        }
      }

    }

    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [
        {
          role: "system",
          content: `
You are the AI receptionist for ScheduleSync barber shops.

You help customers:
- check appointments
- book appointments
- cancel appointments
- reschedule appointments
- check barber availability

Customer phone: ${from || "unknown"}
Customer email: ${email || "unknown"}
Barber ID: ${barberId || "unknown"}
Channel: ${channel || "unknown"}

If the channel is EMAIL and a booking/cancel/reschedule request occurs,
do NOT execute it. The system will require SMS confirmation.
`
        },
        {
          role: "user",
          content: message
        }
      ],

      tools: [

        {
          type: "function",
          function: {
            name: "getCustomerAppointments",
            description: "Get appointments for a customer",
            parameters: {
              type: "object",
              properties: {
                phone: { type: "string" }
              },
              required: ["phone"]
            }
          }
        },

        {
          type: "function",
          function: {
            name: "getBarberAvailability",
            description: "Get barber availability",
            parameters: {
              type: "object",
              properties: {
                barberId: { type: "string" }
              },
              required: ["barberId"]
            }
          }
        },

        {
          type: "function",
          function: {
            name: "cancelAppointment",
            description: "Cancel appointment",
            parameters: {
              type: "object",
              properties: {
                appointmentId: { type: "string" }
              },
              required: ["appointmentId"]
            }
          }
        },

        {
          type: "function",
          function: {
            name: "createAppointment",
            description: "Create a new appointment",
            parameters: {
              type: "object",
              properties: {
                barberId: { type: "string" },
                serviceId: { type: "string" },
                date: { type: "string" },
                time: { type: "string" },
                phone: { type: "string" }
              },
              required: ["barberId", "serviceId", "date", "time", "phone"]
            }
          }
        },

        {
          type: "function",
          function: {
            name: "rescheduleAppointment",
            description: "Reschedule an existing appointment",
            parameters: {
              type: "object",
              properties: {
                appointmentId: { type: "string" },
                newDate: { type: "string" },
                newTime: { type: "string" }
              },
              required: ["appointmentId", "newDate", "newTime"]
            }
          }
        }

      ]

    });

    const messageResponse = completion.choices[0].message;

    /*
    Handle tool calls
    */

    if (messageResponse.tool_calls) {

      const tool = messageResponse.tool_calls[0];
      const args = JSON.parse(tool.function.arguments);

      let result = null;

      if (tool.function.name === "getCustomerAppointments") {
        result = await getCustomerAppointments(args.phone || from);
      }

      if (tool.function.name === "getBarberAvailability") {
        result = await getBarberAvailability(args.barberId || barberId);
      }

      if (tool.function.name === "cancelAppointment") {
        result = await cancelAppointment(args.appointmentId);
      }

      if (tool.function.name === "createAppointment") {
        result = await createAppointment(
          args.barberId,
          args.serviceId,
          args.date,
          args.time,
          args.phone || from
        );
      }

      if (tool.function.name === "rescheduleAppointment") {
        result = await rescheduleAppointment(
          args.appointmentId,
          args.newDate,
          args.newTime
        );
      }

      return res.status(200).json({
        success: true,
        reply: JSON.stringify(result)
      });

    }

    const reply = messageResponse.content;

    /*
    EMAIL requires SMS verification
    */

    if (channel === "email") {

      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        phone: from,
        barberId,
        reply
      });

    }

    return res.status(200).json({
      success: true,
      reply
    });

  } catch (error) {

    console.error("assistant error:", error);

    return res.status(500).json({
      success: false,
      error: "Assistant failed"
    });

  }

}
