// api/support-ticket.js

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      email,
      subject,
      message,
      category = 'General',
      priority = 'normal',
      userData = {},
    } = req.body || {};

    if (!email || !subject || !message) {
      return res.status(400).json({
        error: 'email, subject, and message are required',
      });
    }

    if (!process.env.SUPPORT_EMAIL || !process.env.SUPPORT_EMAIL_PASSWORD) {
      return res.status(500).json({
        error: 'Support email credentials not configured',
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SUPPORT_EMAIL,
        pass: process.env.SUPPORT_EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Barber App Support" <${process.env.SUPPORT_EMAIL}>`,
      to: process.env.SUPPORT_EMAIL,
      subject: `[${String(priority).toUpperCase()}] ${subject}`,
      html: `
        <h2>Support Ticket</h2>
        <p><strong>User Email:</strong> ${email}</p>
        <p><strong>User ID:</strong> ${userData.userId || 'N/A'}</p>
        <p><strong>User Role:</strong> ${userData.userRole || 'N/A'}</p>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Screen:</strong> ${userData.screen || 'N/A'}</p>
        <p><strong>Device:</strong> ${
          userData.deviceInfo?.model || 'N/A'
        } - ${userData.deviceInfo?.platform || 'N/A'}</p>
        <p><strong>App Version:</strong> ${
          userData.deviceInfo?.appVersion || 'N/A'
        }</p>

        <h3>Message:</h3>
        <p>${message}</p>

        <h3>Technical Data:</h3>
        <pre>${JSON.stringify(userData, null, 2)}</pre>
      `,
    });

    return res.status(200).json({
      success: true,
      message: 'Support ticket created',
    });
  } catch (error) {
    console.error('Support ticket error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create support ticket',
    });
  }
}
