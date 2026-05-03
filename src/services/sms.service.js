const at = require('../config/africastalking');

async function sendSMS(to, message) {
  const sms = at.SMS;
  try {
    const result = await sms.send({
      to: Array.isArray(to) ? to : [to],
      message,
      from: process.env.AT_SENDER_ID || 'KaziShow',
    });
    console.log('📱 SMS sent:', JSON.stringify(result.SMSMessageData?.Recipients));
    return result;
  } catch (err) {
    console.error('❌ SMS send failed:', err.message);
    throw err;
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
  return `KaziShow: Job marked complete! KSh ${amount} will be sent to your M-Pesa shortly. Thank you for your great service!`;
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
