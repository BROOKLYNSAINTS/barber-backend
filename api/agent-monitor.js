export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { source, type, message, data } = req.body;

    let formattedMessage = `
🚨 SYSTEM ALERT
Source: ${source || "unknown"}
Type: ${type || "unknown"}
Message: ${message || "No message provided"}
`;

    if (source === "stripe" && data) {
      formattedMessage += `
Details:
Customer: ${data.customer || "N/A"}
Amount: ${data.amount ? data.amount / 100 : "N/A"}
Status: ${data.status || "N/A"}
`;
    }

    /* =========================
       🤖 SEND TO YOUR AI AGENT
    ========================= */
    await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: formattedMessage,
      }),
    });

    /* =========================
       💬 SEND TO SLACK
    ========================= */
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: formattedMessage,
        }),
      });
    } else {
      console.log("SLACK_WEBHOOK_URL is missing");
    }

    console.log("AGENT + SLACK ALERT SENT:", formattedMessage);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.log("Agent monitor error:", err.message);
    return res.status(500).json({ error: "Agent monitor failed" });
  }
}