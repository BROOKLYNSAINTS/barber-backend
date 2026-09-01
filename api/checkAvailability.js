import { FirestoreAppointmentProvider } from '../lib/FirestoreAppointmentProvider.js';

const provider = new FirestoreAppointmentProvider();

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
      });
    }

    const {
      barberId,
      serviceId,
      serviceName,
      date,
      time,
    } = req.body || {};

    if (!barberId || !date || !time) {
      return res.status(400).json({
        success: false,
        error: 'barberId, date, and time are required',
      });
    }

    if (typeof provider.checkAvailability === 'function') {
      const result = await provider.checkAvailability({
        barberId,
        serviceId,
        serviceName,
        date,
        time,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    }

    return res.status(200).json({
      success: true,
      availabilityKnown: false,
      available: null,
      suggestions: [],
      message:
        'Availability checking is not available yet. Use createAppointment to confirm whether the slot can be booked.',
    });
  } catch (error) {
    console.error('CHECK AVAILABILITY ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}