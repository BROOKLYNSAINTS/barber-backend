// api/_firebaseAdmin.js

import admin from "firebase-admin";

const apps = {};

export function getAdminApp(source) {
  const value = (source || "").toLowerCase();

  const isPreview =
    value.includes("brooklynsaints") ||
    (value.includes("vercel.app") && !value.includes("barber-backend-ten"));

  const key = isPreview ? "preview" : "production";

  if (!apps[key]) {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing Firebase config");
    }

    apps[key] = admin.initializeApp(
      {
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      },
      key
    );
  }

  return apps[key];
}

export function getAdminDb(source) {
  const app = getAdminApp(source);
  return admin.firestore(app);
}

export function getAdminAuth(source) {
  const app = getAdminApp(source);
  return admin.auth(app);
}