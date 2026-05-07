import admin from "firebase-admin";
import { getAdminDb } from "./_firebaseAdmin.js";

/*
Get customer appointments
*/
export async function getCustomerAppointments(phone, req) {

  if (!phone) return [];

  const db = getAdminDb(req?.headers?.host);

  const snapshot = await db
    .collection("appointments")
    .where("customerPhone", "==", phone)
    .orderBy("startTime", "asc")
    .limit(10)
    .get();

  if (snapshot.empty) return [];

  const appointments = [];

  snapshot.forEach(doc => {
    appointments.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return appointments;
}

/*
Get barber availability
*/
export async function getBarberAvailability(barberId, req) {

  if (!barberId) return [];

  const db = getAdminDb(req?.headers?.host);

  const snapshot = await db
    .collection("availability")
    .where("barberId", "==", barberId)
    .get();

  if (snapshot.empty) return [];

  const availability = [];

  snapshot.forEach(doc => {
    availability.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return availability;
}

/*
Cancel appointment
*/
export async function cancelAppointment(appointmentId, req) {

  if (!appointmentId) {
    throw new Error("Missing appointmentId");
  }

  const db = getAdminDb(req?.headers?.host);

  const apptRef = db.collection("appointments").doc(appointmentId);

  await apptRef.update({
    status: "cancelled",
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    success: true,
    appointmentId
  };
}

/*
Create appointment
*/
export async function createAppointment(barberId, serviceId, date, time, phone, req) {

  const db = getAdminDb(req?.headers?.host);

  const docRef = db.collection("appointments").doc();

  const appointment = {
    barberId,
    serviceId,
    date,
    time,
    customerPhone: phone,
    status: "scheduled",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await docRef.set(appointment);

  return {
    success: true,
    appointmentId: docRef.id
  };
}

/*
Reschedule appointment
*/
export async function rescheduleAppointment(appointmentId, newDate, newTime, req) {

  if (!appointmentId) {
    throw new Error("Missing appointmentId");
  }

  const db = getAdminDb(req?.headers?.host);

  const apptRef = db.collection("appointments").doc(appointmentId);

  await apptRef.update({
    date: newDate,
    time: newTime,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    success: true,
    appointmentId,
    newDate,
    newTime
  };
}

/*
Find next appointment for a customer
*/
export async function findCustomerNextAppointment(phone, req) {

  if (!phone) return null;

  const db = getAdminDb(req?.headers?.host);

  const snapshot = await db
    .collection("appointments")
    .where("customerPhone", "==", phone)
    .where("status", "in", ["scheduled", "confirmed"])
    .orderBy("startTime", "asc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];

  return {
    appointmentId: doc.id,
    ...doc.data()
  };
}
