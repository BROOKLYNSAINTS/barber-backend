// api/connect-return.js

import { adminDb } from "./_firebaseAdmin.js";

const db = adminDb;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const { state, account, returnUrl } = req.query || {};

  if (
    typeof state === "string" &&
    state.length &&
    typeof account === "string" &&
    account.length
  ) {
    try {
      await db.collection("users").doc(state).update({
        stripeConnectAccountId: account,
        stripeConnectOnboardingComplete: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      // do not block redirect
    }
  }

  const fallbackReturnUrl =
    "barberclean://stripe-connect-return";

  const baseReturnUrl =
    typeof returnUrl === "string" && returnUrl.length
      ? returnUrl
      : fallbackReturnUrl;

  const joiner = baseReturnUrl.includes("?") ? "&" : "?";

  const redirectTo =
    `${baseReturnUrl}${joiner}success=1` +
    (state ? `&state=${encodeURIComponent(state)}` : "") +
    (account ? `&account=${encodeURIComponent(account)}` : "");

  res.statusCode = 302;
  res.setHeader("Location", redirectTo);
  return res.end();
}
