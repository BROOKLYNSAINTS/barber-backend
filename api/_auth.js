// api/_auth.js

import { getAdminApp } from "./_firebaseAdmin.js";

export async function verifyAuthToken(req) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ No Authorization header");
      return null;
    }

    const token = authHeader.split("Bearer ")[1];

    // 🔴 Prefer explicit header from frontend, fallback to host
    const source =
      req.headers["x-backend-base-url"] ||
      req.headers.host ||
      "";

    const adminApp = getAdminApp(source);

    const decoded = await adminApp.auth().verifyIdToken(token);

    return decoded;

  } catch (error) {
    console.log("❌ TOKEN VERIFY ERROR:", error.message);
    return null;
  }
}