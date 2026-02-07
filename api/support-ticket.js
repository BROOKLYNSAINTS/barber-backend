// Add to backend: /api/support-ticket.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, subject, message, category, priority, userData } = req.body;

    // Option 1: Forward to Crisp via API (if they have API)
    // Option 2: Send email to your support address
    
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransporter({
      // Your email service config
      service: 'gmail',
      auth: {
        user: process.env.SUPPORT_EMAIL,
        pass: process.env.SUPPORT_EMAIL_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.SUPPORT_EMAIL,
      to: 'support@yourbarberapp.com',
      subject: `[${priority.toUpperCase()}] ${subject}`,
      html: `
        <h2>Support Ticket from ${userData.userRole}</h2>
        <p><strong>User:</strong> ${email} (${userData.userId})</p>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Screen:</strong> ${userData.screen}</p>
        <p><strong>Device:</strong> ${userData.deviceInfo.model} - ${userData.deviceInfo.platform}</p>
        <p><strong>App Version:</strong> ${userData.deviceInfo.appVersion}</p>
        
        <h3>Problem Description:</h3>
        <p>${message}</p>
        
        <h3>Technical Data:</h3>
        <pre>${JSON.stringify(userData, null, 2)}</pre>
      `
    });

    // Also log to your database for tracking
    // await logSupportTicket(userData);

    res.status(200).json({ success: true, message: 'Support ticket created' });

  } catch (error) {
    console.error('Support ticket error:', error);
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
}