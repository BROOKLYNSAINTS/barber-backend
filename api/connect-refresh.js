// api/connect-refresh.js
import Stripe from "stripe";
import { adminDb } from "./_firebaseAdmin.js";
import { verifyAuthToken } from "./_auth.js";

const db = adminDb;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    try {
      const query = req.query || {};
      const state = typeof query.state === "string" ? query.state : "";
      const account = typeof query.account === "string" ? query.account : "";
      const returnUrlRaw =
        typeof query.returnUrl === "string" ? query.returnUrl : "";

      const fallbackReturnUrl =
        "barberclean://stripe-connect-return";

      const baseReturnUrl = returnUrlRaw || fallbackReturnUrl;
      const joiner = baseReturnUrl.includes("?") ? "&" : "?";

      const redirectTo =
        `${baseReturnUrl}${joiner}` +
        `success=0&refresh=1` +
        (state ? `&state=${encodeURIComponent(state)}` : "") +
        (account ? `&account=${encodeURIComponent(account)}` : "");

      res.statusCode = 302;
      res.setHeader("Location", redirectTo);
      return res.end();
    } catch (error) {
      return res.status(500).send("Error handling connect refresh");
    }
  }

  if (req.method === "POST") {
    try {
      const user = await verifyAuthToken(req);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { userId } = req.body || {};
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(200).json({
          success: true,
          onboardingComplete: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
        });
      }

      const userData = userSnap.data() || {};
      const accountId =
        userData.stripeAccountId ||
        userData.stripeConnectAccountId ||
        null;

      if (!accountId) {
        return res.status(200).json({
          success: true,
          onboardingComplete: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
        });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2023-10-16",
      });

      const account = await stripe.accounts.retrieve(accountId);

      const chargesEnabled = !!account.charges_enabled;
      const payoutsEnabled = !!account.payouts_enabled;
      const detailsSubmitted = !!account.details_submitted;

      const onboardingComplete =
        detailsSubmitted && chargesEnabled;

      return res.status(200).json({
        success: true,
        onboardingComplete,
        accountId,
        chargesEnabled,
        payoutsEnabled,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        onboardingComplete: false,
        accountId: null,
        error:
          error.message ||
          "Failed to refresh Connect status",
      });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
