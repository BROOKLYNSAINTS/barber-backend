export default function handler(req, res) {
  res.json({
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    stripeKeyFirstChar: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.substring(0, 3) : null,
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(key => !key.includes('SECRET'))
  });
}