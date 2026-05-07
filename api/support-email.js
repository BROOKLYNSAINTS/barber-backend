export const config = {
  api: {
    bodyParser: false,
  },
};

import Busboy from "busboy";

/*
Ask central AI assistant (FIXED + SAFE)
*/
async function askAssistant({ message, email }) {
  const API_BASE =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!API_BASE) {
    console.error("Missing PUBLIC_API_BASE_URL");
    return {
      reply: "System configuration error. Please try again later.",
      requiresConfirmation: false,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20 sec timeout

    const response = await fetch(`${API_BASE}/api/assistant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        email,
        channel: "email",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!data.success) {
      console.error("Assistant error:", data);
      return {
        reply: "Sorry, something went wrong while processing your request.",
        requiresConfirmation: false,
      };
    }

    return data;

  } catch (err) {
    console.error("Assistant fetch failed:", err);

    return {
      reply: "Sorry, we’re having trouble responding right now.",
      requiresConfirmation: false,
    };
  }
}

/*
Send SMS via Twilio
*/
async function sendSMS(phone, message) {
  if (!phone) return;

  try {
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone,
          From: process.env.TWILIO_SYSTEM_NUMBER,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Twilio SMS error:", err);
    }

  } catch (err) {
    console.error("Twilio send failed:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const busboy = Busboy({ headers: req.headers });

    let emailText = "";
    let fromEmail = "";
    let subject = "";

    busboy.on("field", (name, value) => {
      if (name === "text") emailText = value;
      if (name === "subject") subject = value;

      if (name === "from") {
        const match = value.match(/<(.+?)>/);
        fromEmail = match ? match[1] : value.trim();
      }
    });

    busboy.on("finish", async () => {
      try {
        if (!fromEmail) {
          return res.status(400).send("Missing sender email");
        }

        const assistantResult = await askAssistant({
          message: emailText || "Customer sent an email with no body.",
          email: fromEmail,
        });

        const reply =
          assistantResult.reply ||
          "Thank you for contacting support.";

        // SMS confirmation if needed
        if (assistantResult.requiresConfirmation && assistantResult.phone) {
          const smsMessage = `ScheduleSync AI

Reply YES to confirm this request:

${reply}

Reply NO to cancel.`;

          await sendSMS(assistantResult.phone, smsMessage);
        }

        // Send email reply via SendGrid
        const sendResponse = await fetch(
          "https://api.sendgrid.com/v3/mail/send",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              personalizations: [
                {
                  to: [{ email: fromEmail }],
                },
              ],
              from: {
                email: "support@wedotime.com",
                name: "ScheduleSync AI Support",
              },
              subject: `Re: ${subject || "Support Request"}`,
              content: [
                {
                  type: "text/plain",
                  value: reply,
                },
              ],
            }),
          }
        );

        if (!sendResponse.ok) {
          const errText = await sendResponse.text();
          console.error("SendGrid error:", errText);
        }

        return res.status(200).send("Email processed");

      } catch (innerError) {
        console.error("Processing error:", innerError);
        return res.status(500).send("Processing failed");
      }
    });

    req.pipe(busboy);

  } catch (error) {
    console.error("Support email error:", error);
    return res.status(500).send("Internal Server Error");
  }
}