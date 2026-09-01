import { getBarberByPhone } from "./barber.js";
import { FirestoreAppointmentProvider } from "./FirestoreAppointmentProvider.js";

const provider = new FirestoreAppointmentProvider();

export async function checkCustomerStatus(db, phoneNumber) {
  const normalizedPhone = phoneNumber.replace(/\D/g, "");

  const possiblePhones = [
    phoneNumber,
    normalizedPhone,
    `+${normalizedPhone}`,
  ];

  let userDoc = null;

  for (const phone of possiblePhones) {
    const snap = await db
      .collection("users")
      .where("role", "==", "customer")
      .where("phone", "==", phone)
      .limit(1)
      .get();

    if (!snap.empty) {
      userDoc = snap.docs[0];
      break;
    }
  }

  if (!userDoc) {
    return {
      ok: true,
      customerFound: false,
      message: "Customer not found. Customer must register in the mobile app.",
    };
  }

  const user = userDoc.data();

  const paymentMethodId =
    user.defaultPaymentMethodId ||
    user.customerStripePaymentMethodId;

  return {
    ok: true,
    customerFound: true,
    customerId: userDoc.id,
    customerName: user.name || "",
    customerPhone: user.phone || phoneNumber,
    stripeCustomerId: user.stripeCustomerId || null,
    hasPaymentMethod:
      !!paymentMethodId &&
      paymentMethodId !== "ok",
    defaultPaymentMethodId: paymentMethodId || null,
  };
}

export async function getBarberFromCalledNumber(db, calledNumber, host) {
  const barber = await getBarberByPhone(calledNumber, host);

  if (!barber) {
    return {
      ok: false,
      barberFound: false,
      message: "Barber not found for this phone number.",
    };
  }

  return {
    ok: true,
    barberFound: true,
    barber,
  };
}

export async function getBarberServices(db, barberId) {
  const servicesSnap = await db
    .collection("users")
    .doc(barberId)
    .collection("services")
    .get();

  const services = servicesSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return {
    ok: true,
    services,
  };
}

export async function createBarberAppointment(appointmentData) {
  return provider.createAppointment(appointmentData);
}