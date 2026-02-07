// api/connect-return.js
// Stripe Connect onboarding "return_url" endpoint
// Redirects back into the app via barberclean://stripe-connect-return

export default async function handler(req, res) {
  // Minimal, safe headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  // Stripe may append query params. We'll pass through what we can.
  const query = req.query || {};
  const state = typeof query.state === 'string' ? query.state : '';
  const account = typeof query.account === 'string' ? query.account : '';
  const success = '1';

  const returnUrlRaw =
    typeof query.returnUrl === 'string' ? query.returnUrl : '';

  // Fallback deep link into the app
  const fallbackReturnUrl = 'barberclean://stripe-connect-return';

  const baseReturnUrl = returnUrlRaw || fallbackReturnUrl;

  // Append parameters to the return URL (preserving existing querystring)
  const hasQ = baseReturnUrl.includes('?');
  const joiner = hasQ ? '&' : '?';

  const redirectTo =
    `${baseReturnUrl}${joiner}` +
    `success=${encodeURIComponent(success)}` +
    (state ? `&state=${encodeURIComponent(state)}` : '') +
    (account ? `&account=${encodeURIComponent(account)}` : '');

  console.log('✅ Stripe Connect onboarding completed. Redirecting to app:', redirectTo);

  // 302 redirect is key (do NOT render an HTML page)
  res.statusCode = 302;
  res.setHeader('Location', redirectTo);
  return res.end();
}
