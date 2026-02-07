// googleSpeech.js (Vercel Serverless Function)

import { Readable } from 'stream';
import { GoogleAuth } from 'google-auth-library';
import { SpeechClient } from '@google-cloud/speech';

export const config = {
  api: {
    bodyParser: false, // We'll handle the stream ourselves
  },
};

const client = new SpeechClient({
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  projectId: process.env.GCP_PROJECT_ID,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const audioChunks = [];
    req.on('data', (chunk) => audioChunks.push(chunk));
    req.on('end', async () => {
      const audioBuffer = Buffer.concat(audioChunks);

      const [response] = await client.recognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-US',
        },
        audio: {
          content: audioBuffer.toString('base64'),
        },
      });

      const transcript = response.results
        .map((r) => r.alternatives?.[0]?.transcript)
        .join(' ');

      return res.status(200).json({ transcript });
    });
  } catch (error) {
    console.error('Google Speech Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
