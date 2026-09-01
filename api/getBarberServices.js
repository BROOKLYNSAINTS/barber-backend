import { getAdminDb } from './_firebaseAdmin.js';
import { getBarberByPhone } from '../lib/barber.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
      });
    }

    const db = getAdminDb(req.headers.host);

    const { calledNumber, barberPhone, barberId } = req.body || {};

    let barber = null;

    if (barberId) {
      const barberDoc = await db.collection('users').doc(barberId).get();

      if (barberDoc.exists) {
        barber = {
          id: barberDoc.id,
          ...barberDoc.data(),
        };
      }
    } else {
      const phoneToSearch = calledNumber || barberPhone;

      if (!phoneToSearch) {
        return res.status(400).json({
          success: false,
          error: 'calledNumber or barberId is required',
        });
      }

      barber = await getBarberByPhone(phoneToSearch, req.headers.host);
    }

    if (!barber) {
      return res.status(200).json({
        success: true,
        barberFound: false,
        services: [],
        serviceNames: [],
        serviceSummary: '',
        message: 'Barber not found for this phone number.',
      });
    }

    const servicesSnap = await db
      .collection('users')
      .doc(barber.id)
      .collection('services')
      .get();

    const services = servicesSnap.docs.map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        name: data.name || '',
        price: Number(data.price || 0),
        duration: Number(data.duration || 30),
      };
    });

    const serviceSummary = services
      .map((s) => `${s.name} $${s.price}`)
      .join(', ');

    return res.status(200).json({
      success: true,
      barberFound: true,
      barberId: barber.id,
      barberName: barber.name || '',
      barberPhone:
        barber.twilioPhoneNumber ||
        calledNumber ||
        barberPhone ||
        barber.phone ||
        '',
      services,
      serviceNames: services.map((s) => s.name).filter(Boolean),
      serviceSummary,
      message:
        services.length > 0
          ? 'Services found.'
          : 'No services found for this barber.',
    });
  } catch (error) {
    console.error('GET BARBER SERVICES ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}