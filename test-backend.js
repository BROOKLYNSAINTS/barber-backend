const fetch = require('node-fetch');

async function testBackend() {
  const BACKEND_URL = 'http://localhost:3000';
  
  console.log('🧪 Testing Backend Connection...');
  
  try {
    // Test health endpoint
    const healthResponse = await fetch(`${BACKEND_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
    
    // Test payment intent creation
    const paymentResponse = await fetch(`${BACKEND_URL}/create-payment-intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 2500, // $25.00
        currency: 'usd',
        metadata: {
          appointmentId: 'test-appointment-123',
          userId: 'test-user-456'
        }
      })
    });
    
    const paymentData = await paymentResponse.json();
    
    if (paymentResponse.ok) {
      console.log('✅ Payment intent created successfully');
      console.log('Payment Intent ID:', paymentData.paymentIntent);
      console.log('Client Secret:', paymentData.clientSecret ? 'Present' : 'Missing');
    } else {
      console.log('❌ Payment intent creation failed:', paymentData);
    }
    
  } catch (error) {
    console.error('❌ Backend test failed:', error.message);
    console.log('💡 Make sure your backend server is running with: npm run dev');
  }
}

testBackend();
