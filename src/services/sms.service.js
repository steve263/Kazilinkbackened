const AfricasTalking = require('africastalking');

let atClient = null;

function getATClient() {
  if (!atClient) {
    const apiKey  = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME;

    console.log('📱 AT Config Check:');
    console.log('  Username:', username);
    console.log('  API Key exists:', !!apiKey);

    if (!apiKey || !username) {
      console.error('❌ AT_API_KEY or AT_USERNAME missing from environment!');
      return null;
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

async function sendSMS(phone, message) {
  // Handle array of phones (broadcast) — send individually
  if (Array.isArray(phone)) {
    const results = await Promise.allSettled(phone.map((p) => sendSMS(p, message)));
    const sent    = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
    const failed  = results.length - sent;
    if (failed > 0) console.warn(`⚠️ Broadcast SMS: ${sent} sent, ${failed} failed`);
    return { success: sent > 0, sent, failed };
  }

  console.log('📤 sendSMS called');
  console.log('  To:', phone);
  console.log('  Msg:', message?.slice(0, 80));

  try {
    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) {
      console.error('❌ sendSMS skipped — invalid phone:', phone);
      return { success: false, error: 'invalid_phone' };
    }

    const client = getATClient();
    if (!client) {
      console.error('❌ sendSMS skipped — AT client not available (check AT_API_KEY / AT_USERNAME env vars)');
      return { success: false, error: 'client_unavailable' };
    }

    const sendOpts = { to: [formattedPhone], message };
    if (process.env.AT_SENDER_ID) sendOpts.from = process.env.AT_SENDER_ID;

    const result = await client.SMS.send(sendOpts);

    console.log('📊 AT raw response:', JSON.stringify(result?.SMSMessageData));

    const recipient = result?.SMSMessageData?.Recipients?.[0];
    const status    = recipient?.status;
    const cost      = recipient?.cost;

    if (status === 'Success') {
      console.log(`✅ SMS sent to ${formattedPhone} | cost: ${cost}`);
      return { success: true, status, cost };
    } else {
      // Surface the real AT error code so it appears in Railway logs
      console.error(
        `❌ SMS FAILED to ${formattedPhone} | AT status: "${status}" | cost: ${cost}` +
        `\n   Possible causes: AT sandbox (whitelist only), no credits, unregistered sender ID` +
        `\n   AT_USERNAME: ${process.env.AT_USERNAME || 'NOT SET'}`
      );
      return { success: false, status, error: status };
    }
  } catch (err) {
    console.error('❌ sendSMS exception:', err.message, err);
    return { success: false, error: err.message };
  }
}

async function testSMS(phone, message) {
  const formattedPhone = formatPhone(phone);
  const client = getATClient();

  if (!client) {
    return {
      success: false,
      error: 'AT client not available',
      env: {
        AT_USERNAME: process.env.AT_USERNAME || 'NOT SET',
        AT_API_KEY_SET: !!process.env.AT_API_KEY,
      },
    };
  }

  try {
    const sendOpts = {
      to: [formattedPhone || phone],
      message: message || `KaziShow SMS test at ${new Date().toISOString()}`,
    };
    if (process.env.AT_SENDER_ID) sendOpts.from = process.env.AT_SENDER_ID;

    const result = await client.SMS.send(sendOpts);

    const recipients = result?.SMSMessageData?.Recipients || [];
    const isSandbox  = process.env.AT_USERNAME === 'sandbox';

    return {
      success: recipients[0]?.status === 'Success',
      atUsername: process.env.AT_USERNAME,
      isSandbox,
      formattedPhone,
      rawResponse: result?.SMSMessageData,
      recipients,
      sandboxWarning: isSandbox
        ? 'You are in AT SANDBOX mode. Only whitelisted numbers receive SMS. Go to https://account.africastalking.com/apps/sandbox/config and add the phone to Sandbox Whitelist, OR switch to your live API key.'
        : null,
    };
  } catch (err) {
    return { success: false, error: err.message, stack: err.stack };
  }
}

async function sendOTP(phone, otp) {
  return sendSMS(
    phone,
    `Your KaziShow verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`
  );
}

// ─── Message templates ────────────────────────────────────────────────────────

function tplNewBookingProvider(customerName, service, location, amount) {
  return `KaziShow: New booking from ${customerName}! ${service} at ${location}. KSh ${amount}. Open the app to accept or decline.`;
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
  sendSMS,
  sendOTP,
  testSMS,
  formatPhone,
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
