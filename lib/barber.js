import { getAdminDb } from "../api/_firebaseAdmin.js";

export async function getBarberByPhone(
  phoneNumber,
  host
) {

  try {

    console.log(
      "Searching for Twilio number:",
      JSON.stringify(phoneNumber)
    );

    const db =
      getAdminDb(host);

    const snapshot = await db
      .collection("users")
      .where(
        "twilioPhoneNumber",
        "==",
        phoneNumber
      )
      .limit(1)
      .get();

    console.log(
      "Snapshot empty:",
      snapshot.empty
    );

    console.log(
      "Snapshot size:",
      snapshot.size
    );

    if (snapshot.empty) {

      console.log(
        "NO MATCH FOUND"
      );

      return null;
    }

    const doc =
      snapshot.docs[0];

    console.log(
      "MATCH FOUND:",
      doc.id
    );

    console.log(
      "DB VALUE:",
      JSON.stringify(
        doc.data().twilioPhoneNumber
      )
    );

    return {
      id: doc.id,
      ...doc.data(),
    };

  } catch (error) {

    console.error(
      "getBarberByPhone error:",
      error
    );

    return null;
  }
}