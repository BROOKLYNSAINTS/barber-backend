import { getAdminDb } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
      });
    }

    const db = getAdminDb(req.headers.host);

    const { phoneNumber } = req.body || {};

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required',
      });
    }

    const digits = String(phoneNumber).replace(/\D/g, '');

    const possiblePhones = [
      phoneNumber,
      digits,
      `+${digits}`,
      digits.length === 10 ? `+1${digits}` : null,
      digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null,
      digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : null,
    ].filter(Boolean);

    console.log('CHECK CUSTOMER STATUS:', {
      phoneNumber,
      possiblePhones,
    });

    let customerDoc = null;

    for (const phone of possiblePhones) {
      const snapshot = await db
        .collection('users')
        .where('phone', '==', phone)
        .where('role', '==', 'customer')
        .limit(1)
        .get();

      if (!snapshot.empty) {
        customerDoc = snapshot.docs[0];
        break;
      }
    }

    if (!customerDoc) {
      return res.status(200).json({
        success: true,
        customerExists: false,
        customerId: null,
        customerName: null,
        phoneNumber,
        hasPaymentMethod: false,
        defaultPaymentMethodId: null,
        stripeCustomerId: null,
        canContinue: false,
        message: 'Customer not found. Please register in the mobile app.',
      });
    }

    const customer = customerDoc.data();

    const paymentMethodId =
      customer.defaultPaymentMethodId ||
      customer.customerStripePaymentMethodId ||
      null;

    const hasPaymentMethod =
      !!paymentMethodId && paymentMethodId !== 'ok';

    return res.status(200).json({
      success: true,
      customerExists: true,
      customerId: customerDoc.id,
      customerName: customer.name || '',
      phoneNumber: customer.phone || phoneNumber,
      hasPaymentMethod,
      defaultPaymentMethodId: paymentMethodId,
      stripeCustomerId: customer.stripeCustomerId || null,
      canContinue: hasPaymentMethod,
      message: hasPaymentMethod
        ? 'Customer found and has a payment method on file.'
        : 'Customer found but does not have a valid payment method on file.',
    });
  } catch (error) {
    console.error('CHECK CUSTOMER STATUS ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}