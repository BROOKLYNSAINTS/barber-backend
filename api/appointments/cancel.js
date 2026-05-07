import admin from "firebase-admin";
import { getAdminDb } from "../_firebaseAdmin.js";

/**
 * Hours until appointment (local-safe)
 */
function hoursUntilAppointment(date, time) {
  const [hour, minute] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);

  const appt = new Date(year, month - 1, day, hour, minute, 0);
  const now = new Date();

  return (appt - now) / (1000 * 60 * 60);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ FIX: db inside handler
    const db = getAdminDb(req.headers.host);

    /* ----------------------------------
     * Auth
     * ---------------------------------- */
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = await admin.auth().verifyIdToken(token);
    const customerId = decoded.uid;

    const { appointmentId } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ error: "Missing appointmentId" });
    }

    const apptRef = db.collection("appointments").doc(appointmentId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(apptRef);
      if (!snap.exists) throw new Error("Appointment not found");

      const appt = snap.data();

      if (appt.customerId !== customerId) {
        throw new Error("Unauthorized");
      }

      if (appt.status !== "confirmed") {
        throw new Error("Appointment not cancellable");
      }

      const barberRef = db.collection("users").doc(appt.barberId);
      const barberSnap = await tx.get(barberRef);
      const settings = barberSnap.data()?.noShowSettings;

      const hoursRemaining = hoursUntilAppointment(appt.date, appt.time);

      const insideWindow =
        settings?.enabled &&
        hoursRemaining < settings.cancellationWindowHours;

      /* ----------------------------------
       * NORMAL CANCEL
       * ---------------------------------- */
      if (!insideWindow) {
        tx.update(apptRef, {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { lateCancel: false };
      }

      /* ----------------------------------
       * LATE CANCEL → PENDING CHARGE
       * ---------------------------------- */
      tx.update(apptRef, {
        status: "late_cancel",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        noShowProtection: {
          status: "pending_charge",
          feeType: settings.feeType,
          feeAmount: settings.feeAmount,
          source: "late_cancel",
        },
      });

      return {
        lateCancel: true,
        message: "Late cancellation fee will be charged",
      };
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ Cancel failed:", err);
    return res.status(400).json({ error: err.message });
  }
}
