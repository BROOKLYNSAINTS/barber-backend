import admin from "firebase-admin";



const db = admin.firestore();

async function updateBarbers() {
  const snapshot = await db
    .collection("users")
    .where("role", "==", "barber")
    .get();

  if (snapshot.empty) {
    console.log("No barber users found");
    return;
  }

  const batch = db.batch();
  let count = 0;

  snapshot.docs.forEach(doc => {
    const ref = doc.ref;

    batch.update(ref, {
      "noShowSettings.enabled": false,
      "noShowSettings.requireCard": false,
      "noShowSettings.cancellationWindowHours": 24,
      "noShowSettings.feeType": "flat",
      "noShowSettings.feeAmount": 25,
      "noShowSettings.updatedAt": admin.firestore.FieldValue.serverTimestamp()
    });

    count++;
  });

  await batch.commit();
  console.log(`Updated ${count} barber documents`);
}

updateBarbers().catch(console.error);
