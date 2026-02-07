#!/bin/bash

echo "🔧 Barber App Stripe Setup Script"
echo "=================================="
echo ""

# Check if user has Stripe keys
echo "📋 Before running this script, make sure you have:"
echo "   1. Stripe publishable key (pk_test_...)"
echo "   2. Stripe secret key (sk_test_...)"
echo ""

read -p "Do you have your Stripe keys ready? (y/n): " has_keys

if [ "$has_keys" != "y" ]; then
    echo ""
    echo "🔑 Please get your Stripe keys first:"
    echo "   1. Go to: https://dashboard.stripe.com/test/apikeys"
    echo "   2. Copy your publishable key (pk_test_...)"
    echo "   3. Copy your secret key (sk_test_...) - click 'Reveal token'"
    echo ""
    echo "   Then run this script again."
    exit 1
fi

echo ""
echo "🔑 Enter your Stripe keys:"
echo ""

# Get publishable key for frontend
read -p "Enter your Stripe PUBLISHABLE key (pk_test_...): " pub_key
if [[ ! $pub_key =~ ^pk_test_ ]]; then
    echo "❌ Invalid publishable key. Should start with 'pk_test_'"
    exit 1
fi

# Get secret key for backend
read -p "Enter your Stripe SECRET key (sk_test_...): " secret_key
if [[ ! $secret_key =~ ^sk_test_ ]]; then
    echo "❌ Invalid secret key. Should start with 'sk_test_'"
    exit 1
fi

echo ""
echo "📝 Updating configuration files..."

# Update frontend .env
echo "🔄 Updating frontend .env file..."
cd /Users/josephmurphy/barber-clean
if ! grep -q "STRIPE_PUBLISHABLE_KEY" .env 2>/dev/null; then
    echo "" >> .env
    echo "# Stripe Configuration" >> .env
fi
sed -i '' "s/STRIPE_PUBLISHABLE_KEY=.*/STRIPE_PUBLISHABLE_KEY=$pub_key/" .env 2>/dev/null || echo "STRIPE_PUBLISHABLE_KEY=$pub_key" >> .env

# Update backend .env
echo "🔄 Updating backend .env file..."
cd /Users/josephmurphy/barber-backend
sed -i '' "s/STRIPE_SECRET_KEY=.*/STRIPE_SECRET_KEY=$secret_key/" .env

echo ""
echo "✅ Configuration updated successfully!"
echo ""
echo "🧪 Testing backend locally..."

# Test backend
npm start &
backend_pid=$!
sleep 3

# Test health endpoint
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Backend is running successfully!"
    kill $backend_pid
else
    echo "❌ Backend test failed"
    kill $backend_pid 2>/dev/null
    exit 1
fi

echo ""
echo "🚀 Ready for deployment!"
echo ""
echo "📋 Next steps:"
echo "   1. Deploy backend: cd /Users/josephmurphy/barber-backend && npx vercel --prod"
echo "   2. Update frontend with your backend URL"
echo "   3. Test payments in your app"
echo ""
