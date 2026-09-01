import { getAdminDb } from "../api/_firebaseAdmin.js";
import admin from "firebase-admin";

const db = getAdminDb();

/*
TIME HELPERS
*/

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;

  const raw = String(timeStr)
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  let m = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);

    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

    return hh * 60 + mm;
  }

  m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);

  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];

    if (ap === "AM") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }

    return hh * 60 + mm;
  }

  return null;
}

function normalizeTimeToHHMM24(timeStr) {
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes == null) return null;

  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function minutesToHHMM(totalMinutes) {
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

async function getServiceDurationMinutesCached({ barberId, serviceId, cache }) {
  if (!serviceId) return 30;

  if (cache.has(serviceId)) return cache.get(serviceId);

  let dur = 30;

  try {
    const snap = await db
      .collection("users")
      .doc(barberId)
      .collection("services")
      .doc(serviceId)
      .get();

    if (snap.exists) {
      const data = snap.data() || {};

      if (typeof data.duration === "number" && data.duration > 0) {
        dur = data.duration;
      }
    }
  } catch (err) {
    console.log("duration lookup error:", err);
  }

  cache.set(serviceId, dur);

  return dur;
}

export class FirestoreAppointmentProvider {
  async createAppointment({
    barberId,
    barberName,
    customerName,
    customerPhone,
    serviceId,
    serviceName,
    date,
    time,
    price,
    servicePrice,
  }) {
    try {
      const normalizedTime = normalizeTimeToHHMM24(time);

      if (!normalizedTime) {
        return {
          ok: false,
          error: "invalid_time",
        };
      }

      const resolvedServicePrice = Number(servicePrice ?? price ?? 0);

      const durationCache = new Map();

      const durationMinutes = await getServiceDurationMinutesCached({
        barberId,
        serviceId,
        cache: durationCache,
      });

      const startMin = parseTimeToMinutes(normalizedTime);
      const endMin = startMin + durationMinutes;

      const apptRef = db.collection("appointments").doc();

      const appointment = {
        barberId,
        barberName: barberName || "",
        customerName: customerName || "",
        customerPhone: customerPhone || "",
        serviceId: serviceId || "",
        serviceName: serviceName || "",
        servicePrice: Number.isFinite(resolvedServicePrice)
          ? resolvedServicePrice
          : 0,
        durationMinutes,
        date,
        time: normalizedTime,
        start: `${date}T${normalizedTime}`,
        end: `${date}T${minutesToHHMM(endMin)}`,
        status: "scheduled",

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await apptRef.set(appointment);

      return {
        ok: true,
        appointment: {
          id: apptRef.id,
          ...appointment,
        },
        confirmationText: `${serviceName} booked for ${date} at ${normalizedTime}`,
      };
    } catch (err) {
      console.error("❌ createAppointment error:", err);

      return {
        ok: false,
        error: "firestore_error",
        message: err.message,
      };
    }
  }
}