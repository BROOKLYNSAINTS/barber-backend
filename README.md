# Barber App Backend Setup

This backend server handles Stripe payment processing for the barber app.

## 🚀 Quick Setup

### 1. Get Your Stripe Keys
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`) - click "Reveal token"

### 2. Run Setup Script
```bash
cd /Users/josephmurphy/barber-backend
./setup.sh
```

### 3. Deploy to Vercel
```bash
# Install Vercel CLI if you haven't
npm i -g vercel

# Deploy
npx vercel --prod

# Set environment variables in Vercel dashboard:
# - STRIPE_SECRET_KEY: your secret key
# - STRIPE_WEBHOOK_SECRET: your webhook secret (optional for now)
```

### 4. Update Frontend
Replace the URL in `/Users/josephmurphy/barber-clean/src/services/stripe.js`:

```javascript
// In createPaymentIntent function, replace:
const response = await fetch('https://your-backend-url.vercel.app/create-payment-intent', {
```

## 📁 Manual Setup

### Backend Setup
1. **Environment Variables**:
   ```bash
   cd /Users/josephmurphy/barber-backend
   # Edit .env file:
   STRIPE_SECRET_KEY=sk_test_your_actual_secret_key_here
   ```

2. **Test Locally**:
   ```bash
   npm start
   # Should show: "Backend is running on port 3000"
   ```

3. **Deploy to Vercel**:
   ```bash
   npx vercel --prod
   ```

### Frontend Setup
1. **Add Stripe Publishable Key**:
   ```bash
   cd /Users/josephmurphy/barber-clean
   # Add to .env file:
   STRIPE_PUBLISHABLE_KEY=pk_test_your_actual_publishable_key_here
   ```

2. **Update Backend URL**:
   In `src/services/stripe.js`, find the `createPaymentIntent` function and replace the commented fetch call with your deployed URL.

## 🧪 Testing

### Test Cards (for Stripe test mode):
- **Success**: `4242424242424242`
- **Decline**: `4000000000000002`
- **Requires 3D Secure**: `4000002500003155`

Use any future expiry date and any 3-digit CVC.

### Test Flow:
1. Create an appointment in the app
2. Go to appointment details
3. Tap "Pay" button
4. Enter test card details
5. Confirm payment

## 🔧 Troubleshooting

### "Neither apiKey nor config.authenticator provided"
- Your `STRIPE_SECRET_KEY` is not set in the backend `.env` file

### "Payment system is not fully configured"
- Backend URL is not updated in the frontend
- Backend is not deployed or not responding

### "secret format does not match expected client secret formatting"
- Backend is returning invalid/demo data instead of real Stripe client secrets
- Check backend logs for errors

## 📊 Monitoring

### Backend Health Check
```bash
curl https://your-backend-url.vercel.app/health
```

### Stripe Dashboard
- Monitor payments: https://dashboard.stripe.com/test/payments
- View logs: https://dashboard.stripe.com/test/logs

## 🔐 Security Notes

- Never commit real secret keys to git
- Use environment variables for all sensitive data
- Test mode keys are safe for development
- Switch to live keys only when ready for production

## 🎯 Architecture

```
Mobile App (React Native)
    ↓ (creates payment intent)
Backend Server (Node.js/Express)
    ↓ (creates PaymentIntent)
Stripe API
    ↓ (returns client secret)
Backend Server
    ↓ (returns client secret)
Mobile App
    ↓ (shows payment sheet)
Stripe Payment Sheet (React Native)
    ↓ (processes payment)
Stripe API
    ↓ (webhook)
Backend Server (optional)
    ↓ (confirms payment)
Firestore Database
```
