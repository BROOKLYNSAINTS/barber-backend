// api/googleSpeech.js

import { SpeechClient } from "@google-cloud/speech";

export const config = {
  api: {
    bodyParser: false,
  },
};

const client = new SpeechClient({
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  projectId: process.env.GCP_PROJECT_ID,
});

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const audioChunks = [];

    req.on("data", (chunk) => audioChunks.push(chunk));

    req.on("end", async () => {

      const audioBuffer = Buffer.concat(audioChunks);

      /*
      Step 1 — Transcribe audio
      */

      const [response] = await client.recognize({

        config: {
          encoding: "LINEAR16",
          sampleRateHertz: 16000,
          languageCode: "en-US",
        },

        audio: {
          content: audioBuffer.toString("base64"),
        },

      });

      const transcript = response.results
        .map((r) => r.alternatives?.[0]?.transcript)
        .join(" ");

      /*
      Step 2 — Ask central AI assistant
      */

      const API_BASE =
        process.env.PUBLIC_API_BASE_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL;

      if (!API_BASE) {
        throw new Error("Missing PUBLIC_API_BASE_URL");
      }

      const assistantResponse = await fetch(
        `${API_BASE}/api/assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: transcript,
            channel: "voice",
          }),
        }
      );

      const assistantData = await assistantResponse.json();

      const reply = assistantData.reply || "Sorry, I didn't understand that.";

      /*
      Step 3 — Return transcript + AI reply
      */

      return res.status(200).json({
        transcript,
        reply,
      });

    });

  } catch (error) {

    console.error("Google Speech Error:", error);

    return res.status(500).json({
      error: "Internal Server Error",
    });

  }
}