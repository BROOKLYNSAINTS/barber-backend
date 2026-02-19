// api/create-customer.js

import Stripe from "stripe";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const bypassSecret = req.query["x-vercel-protection-bypass"];
  if (bypassSecret !== process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const { email, name, userId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email parameter" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    const customers = await stripe.customers.list({
      email,
      limit: 1,
    });

    let customer;

    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          userId: userId || "",
        },
      });
    }

    return res.status(200).json({
      customerId: customer.id,
    });

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Internal server error",
    });
  }
}
