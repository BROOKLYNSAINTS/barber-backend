import admin from "firebase-admin";
import { getAdminDb } from "./_firebaseAdmin.js";

function phoneVariants(phoneNumber = "") {
  const digits = String(phoneNumber).replace(/\D/g, "");

  return [
    phoneNumber,
    digits,
    `+${digits}`,
    digits.length === 10 ? `+1${digits}` : null,
    digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null,
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null,
  ].filter(Boolean);
}

function hoursUntilAppointment(date, time) {
  const [hour, minute = "0"] = String(time).split(":").map(Number);
  const [year, month, day] = String(date).split("-").map(Number);

  const appt = new Date(year, month - 1, day, hour, minute, 0);
  const now = new Date();

  return (appt - now) / (1000 * 60 * 60);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
    }

    const db = getAdminDb(req.headers.host);

    const {
      appointmentId,
      phoneNumber,
      customerPhone,
      date,
      time,
      barberId,
      reason,
    } = req.body || {};

    const callerPhone = phoneNumber || customerPhone;

    if (!appointmentId && !callerPhone) {
      return res.status(400).json({
        success: false,
        error: "appointmentId or phoneNumber is required",
      });
    }

    let appointmentRef = null;
    let appointmentData = null;

    if (appointmentId) {
      appointmentRef = db.collection("appointments").doc(appointmentId);
      const snap = await appointmentRef.get();

      if (!snap.exists) {
        return res.status(200).json({
          success: false,
          appointmentCancelled: false,
          message: "Appointment not found.",
        });
      }

      appointmentData = {
        id: snap.id,
        ...snap.data(),
      };
    } else {
      let customerDoc = null;

      for (const phone of phoneVariants(callerPhone)) {
        const snap = await db
          .collection("users")
          .where("role", "==", "customer")
          .where("phone", "==", phone)
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
          appointmentCancelled: false,
          message: "Customer not found.",
        });
      }

      let query = db
        .collection("appointments")
        .where("customerId", "==", customerDoc.id)
        .where("status", "==", "confirmed")
        .limit(10);

      if (date) {
        query = query.where("date", "==", date);
      }

      const snap = await query.get();

      const matches = snap.docs
        .map((doc) => ({
          ref: doc.ref,
          id: doc.id,
          ...doc.data(),
        }))
        .filter((appt) => {
          if (barberId && appt.barberId !== barberId) return false;
          if (time && appt.time !== time) return false;
          return true;
        });

      if (matches.length === 0) {
        return res.status(200).json({
          success: false,
          appointmentCancelled: false,
          message: "No matching confirmed appointment found.",
        });
      }

      if (matches.length > 1) {
        return res.status(200).json({
          success: false,
          appointmentCancelled: false,
          needsClarification: true,
          matches: matches.map((appt) => ({
            appointmentId: appt.id,
            date: appt.date,
            time: appt.time,
            serviceName: appt.serviceName,
            barberName: appt.barberName,
          })),
          message:
            "Multiple matching appointments found. Ask the caller which appointment they want to cancel.",
        });
      }

      appointmentRef = matches[0].ref;
      appointmentData = matches[0];
    }

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(appointmentRef);

      if (!snap.exists) {
        throw new Error("Appointment not found");
      }

      const appt = snap.data();

      if (appt.status !== "confirmed") {
        throw new Error("Appointment is not cancellable");
      }

      const barberRef = db.collection("users").doc(appt.barberId);
      const barberSnap = await tx.get(barberRef);
      const settings = barberSnap.data()?.noShowSettings || {};

      const hoursRemaining = hoursUntilAppointment(appt.date, appt.time);

      const insideWindow =
        settings?.enabled &&
        Number.isFinite(hoursRemaining) &&
        hoursRemaining < settings.cancellationWindowHours;

      if (!insideWindow) {
        tx.update(appointmentRef, {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancellationReason:
            reason || "Cancelled by phone AI receptionist",
          cancellationSource: "vapi",
        });

        return {
          lateCancel: false,
          feePending: false,
        };
      }

      tx.update(appointmentRef, {
        status: "late_cancel",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancellationReason:
          reason || "Late cancellation by phone AI receptionist",
        cancellationSource: "vapi",
        noShowProtection: {
          status: "pending_charge",
          feeType: settings.feeType,
          feeAmount: settings.feeAmount,
          source: "late_cancel",
        },
      });

      return {
        lateCancel: true,
        feePending: true,
        feeType: settings.feeType,
        feeAmount: settings.feeAmount,
      };
    });

    return res.status(200).json({
      success: true,
      appointmentCancelled: true,
      appointmentId: appointmentRef.id,
      appointment: {
        id: appointmentRef.id,
        ...appointmentData,
      },
      ...result,
      message: result.lateCancel
        ? "Appointment cancelled. This is a late cancellation and a fee may apply."
        : "Appointment cancelled successfully.",
    });
  } catch (error) {
    console.error("VAPI CANCEL APPOINTMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      appointmentCancelled: false,
      error: error.message,
    });
  }
}