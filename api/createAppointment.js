import { getAdminDb } from './_firebaseAdmin.js';
import { getBarberByPhone } from '../lib/barber.js';
import { FirestoreAppointmentProvider } from '../lib/FirestoreAppointmentProvider.js';

const provider = new FirestoreAppointmentProvider();

function phoneVariants(phoneNumber = '') {
  const digits = String(phoneNumber).replace(/\D/g, '');

  return [
    phoneNumber,
    digits,
    `+${digits}`,
    digits.length === 10 ? `+1${digits}` : null,
    digits.length === 11 && digits.startsWith('1')
      ? `+${digits}`
      : null,
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : null,
  ].filter(Boolean);
}

function resolveDate(input) {
  const today = new Date();

  if (!input) {
    return today.toISOString().split('T')[0];
  }

  const lower = String(input).toLowerCase().trim();

  if (lower === 'tomorrow') {
    today.setDate(today.getDate() + 1);
    return today.toISOString().split('T')[0];
  }

  const days = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  const targetDay = days.indexOf(lower);

  if (targetDay >= 0) {
    const currentDay = today.getDay();
    let diff = targetDay - currentDay;

    if (diff <= 0) diff += 7;

    today.setDate(today.getDate() + diff);
    return today.toISOString().split('T')[0];
  }

  return input;
}

function matchService(services, requestedService, requestedServiceId) {
  if (requestedServiceId) {
    const byId = services.find((s) => s.id === requestedServiceId);
    if (byId) return byId;
  }

  const text = String(requestedService || '')
    .toLowerCase()
    .trim();

  if (!text) return null;

  return (
    services.find((s) =>
      text.includes(String(s.name || '').toLowerCase())
    ) ||
    services.find((s) => {
      const serviceName = String(s.name || '')
        .toLowerCase()
        .trim();

      return (
        serviceName.includes(text) ||
        text.includes(serviceName)
      );
    }) ||
    null
  );
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
      });
    }

    const db = getAdminDb(req.headers.host);

    const {
      phoneNumber,
      customerPhone,
      calledNumber,
      barberPhone,
      serviceName,
      serviceId,
      date,
      time,
    } = req.body || {};

    const callerPhone = phoneNumber || customerPhone;
    const shopNumber = calledNumber || barberPhone;

    if (!callerPhone || !shopNumber || !date || !time) {
      return res.status(400).json({
        success: false,
        error:
          'phoneNumber/customerPhone, calledNumber/barberPhone, date, and time are required',
      });
    }

    const barber = await getBarberByPhone(
      shopNumber,
      req.headers.host
    );

    if (!barber) {
      return res.status(200).json({
        success: false,
        appointmentCreated: false,
        message: 'Barber not found for this phone number.',
      });
    }

    let customerDoc = null;

    for (const phone of phoneVariants(callerPhone)) {
      const snap = await db
        .collection('users')
        .where('role', '==', 'customer')
        .where('phone', '==', phone)
        .limit(1)
        .get();

      if (!snap.empty) {
        customerDoc = snap.docs[0];
        break;
      }
    }

    if (!customerDoc) {
      return res.status(200).json({
        success: false,
        appointmentCreated: false,
        message:
          'Customer not found. Please register in the mobile app.',
      });
    }

    const customer = customerDoc.data();

    const paymentMethodId =
      customer.defaultPaymentMethodId ||
      customer.customerStripePaymentMethodId ||
      null;

    if (!paymentMethodId || paymentMethodId === 'ok') {
      return res.status(200).json({
        success: false,
        appointmentCreated: false,
        message:
          'Customer does not have a valid payment method on file.',
      });
    }

    const servicesSnap = await db
      .collection('users')
      .doc(barber.id)
      .collection('services')
      .get();

    const services = servicesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const service = matchService(
      services,
      serviceName,
      serviceId
    );

    if (!service) {
      return res.status(200).json({
        success: false,
        appointmentCreated: false,
        message: `Service not found. Available services are: ${services
          .map((s) => s.name)
          .filter(Boolean)
          .join(', ')}.`,
        services,
      });
    }

    const normalizedDate = resolveDate(date);

    const appointment = await provider.createAppointment({
      barberId: barber.id,
      barberName: barber.name,
      barberPhone: barber.phone,

      customerId: customerDoc.id,
      customerName: customer.name,
      customerPhone: callerPhone,

      serviceId: service.id,
      serviceName: service.name,
      servicePrice: service.price || 0,

      date: normalizedDate,
      time,
    });

    return res.status(200).json({
      success: !!appointment.ok,
      appointmentCreated: !!appointment.ok,
      appointment,
      barberId: barber.id,
      barberName: barber.name,
      customerId: customerDoc.id,
      customerName: customer.name,
      serviceId: service.id,
      serviceName: service.name,
      date: normalizedDate,
      time,
      message: appointment.ok
        ? `Appointment booked for ${normalizedDate} at ${time}.`
        : appointment.message || 'Unable to book appointment.',
    });
  } catch (error) {
    console.error('CREATE APPOINTMENT ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}