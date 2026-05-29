const AfricasTalking = require('africastalking');

let atClient = null;

function getATClient() {
  if (!atClient) {
    const apiKey = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME;

    console.log('🔧 AT Config:');
    console.log('  Username:', username);
    console.log('  API Key exists:', !!apiKey);
    console.log('  API Key length:', apiKey?.length);
    console.log('  API Key prefix:', apiKey?.slice(0, 10));

    if (!apiKey || !username) {
      throw new Error('AT_API_KEY or AT_USERNAME missing from environment');
    }

    atClient = AfricasTalking({ apiKey, username });
  }
  return atClient;
}

function formatPhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim().replace(/\s/g, '');
  if (!p) return null;
  if (p.startsWith('0')) return '+254' + p.slice(1);
  if (p.startsWith('254') && !p.startsWith('+')) return '+' + p;
  if (!p.startsWith('+')) return '+254' + p;
  return p;
}

async function sendOTP(phone, otp) {
  console.log('📱 sendOTP called for:', phone);
  const formattedPhone = formatPhone(phone);
  console.log('📞 Formatted phone:', formattedPhone);

  const message = `Your KaziShow verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;

  console.log("📨 Sending SMS via Africa's Talking...");

  const client = getATClient();
  const result = await client.SMS.send({
    to: [formattedPhone],
    message,
  });

  console.log('✅ AT Response:', JSON.stringify(result, null, 2));

  const recipient = result?.SMSMessageData?.Recipients?.[0];
  console.log('📊 Recipient status:', recipient?.status);
  console.log('💰 Cost:', recipient?.cost);
  console.log('📋 Status code:', recipient?.statusCode);

  if (recipient && recipient.status !== 'Success') {
    throw new Error(`SMS delivery failed: ${recipient.status}`);
  }

  return { success: true, result };
}

async function sendSMS(phone, message) {
  try {
    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) {
      console.error('❌ sendSMS skipped — invalid phone:', phone);
      return { success: false };
    }

    console.log('📱 Sending SMS to:', formattedPhone);
    console.log('📝 Message:', message);

    const client = getATClient();
    const result = await client.SMS.send({
      to: [formattedPhone],
      message,
    });

    const recipient = result?.SMSMessageData?.Recipients?.[0];
    console.log('📊 SMS Status:', recipient?.status);
    console.log('💰 SMS Cost:', recipient?.cost);

    return { success: true, result };
  } catch (err) {
    console.error('❌ sendSMS error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── SMS templates ────────────────────────────────────────────────────────────

function tplNewBookingProvider(customerName, service, location, amount) {
  return `KaziShow: New booking from ${customerName}! ${service} at ${location}. KSh ${amount}. Open the app to accept or decline in 30 seconds.`;
}

function tplBookingAcceptedCustomer(providerName, scheduledTime) {
  return `KaziShow: ${providerName} accepted your booking! They will arrive at approximately ${scheduledTime}. Track them on the KaziShow app.`;
}

function tplBookingDeclinedCustomer(providerName) {
  return `KaziShow: ${providerName} could not accept your booking request. Please try another provider on the app.`;
}

function tplBookingCancelledProvider(customerName) {
  return `KaziShow: ${customerName} cancelled their booking. Please check the app for updates.`;
}

function tplPaymentConfirmed(amount, mpesaRef) {
  return `KaziShow: Payment of KSh ${amount} received. Ref: ${mpesaRef}. Thank you for using KaziShow!`;
}

function tplProviderEnRoute(providerName) {
  return `KaziShow: ${providerName} is on their way to you! Get ready.`;
}

function tplJobCompletedCustomer(providerName) {
  return `KaziShow: Your job with ${providerName} is complete! Please open the app to rate your experience. Thank you for using KaziShow!`;
}

function tplJobCompletedProvider(amount) {
  return `KaziShow: Job marked complete! KSh ${amount}. Thank you for your great service!`;
}

function tplNewOrderBusiness(customerName, serviceName, amount) {
  return `KaziShow: New order from ${customerName}! ${serviceName} — KSh ${amount}. Check your KaziShow dashboard to manage it.`;
}

function tplOrderConfirmedCustomer(businessName, serviceName) {
  return `KaziShow: Your booking at ${businessName} is confirmed! ${serviceName}. See you soon!`;
}

function tplOrderPreparingCustomer(businessName) {
  return `KaziShow: ${businessName} is preparing your order. We'll notify you when it's ready!`;
}

function tplOrderReadyCustomer(businessName) {
  return `KaziShow: Your order at ${businessName} is ready! Please proceed to collect or wait for delivery.`;
}

function tplOrderCompletedCustomer(businessName) {
  return `KaziShow: Your order at ${businessName} is complete! Thank you. Please rate your experience on KaziShow.`;
}

module.exports = {
  sendOTP,
  sendSMS,
  tplNewBookingProvider,
  tplBookingAcceptedCustomer,
  tplBookingDeclinedCustomer,
  tplBookingCancelledProvider,
  tplPaymentConfirmed,
  tplProviderEnRoute,
  tplJobCompletedCustomer,
  tplJobCompletedProvider,
  tplNewOrderBusiness,
  tplOrderConfirmedCustomer,
  tplOrderPreparingCustomer,
  tplOrderReadyCustomer,
  tplOrderCompletedCustomer,
};
