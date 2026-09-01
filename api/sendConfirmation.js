import twilio from 'twilio';

const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const {
      customerPhone,
      customerName,
      serviceName,
      date,
      time,
      barberName,
    } = req.body || {};

    if (!customerPhone || !serviceName || !date || !time) {
      return res.status(400).json({
        success: false,
        error: 'customerPhone, serviceName, date, and time are required',
      });
    }

    const message =
      `Hi ${customerName || ''}, your ${serviceName} appointment` +
      `${barberName ? ` with ${barberName}` : ''} is confirmed for ${date} at ${time}.`;

    const sent = await smsClient.messages.create({
      body: message,
      from: process.env.TWILIO_VERIFIED_SMS_NUMBER,
      to: customerPhone,
    });

    return res.status(200).json({
      success: true,
      messageSent: true,
      sid: sent.sid,
      message,
    });
  } catch (error) {
    console.error('SEND CONFIRMATION ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}