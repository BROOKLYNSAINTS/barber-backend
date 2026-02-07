// api/debug-env.js
export default function handler(req, res) {
  const bypassSecret = req.query['x-vercel-protection-bypass'];
  if (bypassSecret !== process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  res.status(200).json({
    hasStripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasStripeTestSecretKey: !!process.env.STRIPE_TEST_SECRET_KEY,
    stripeRelatedKeys: Object.keys(process.env).filter(key => key.includes('STRIPE')),
  });
}