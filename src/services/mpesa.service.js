const axios = require('axios');
const { getAccessToken, MPESA_BASE_URL } = require('../config/mpesa');

function getTimestamp() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function getPassword(timestamp) {
  return Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');
}

async function stkPush({ phone, amount, bookingId, accountRef, description }) {
  const token = await getAccessToken();
  const timestamp = getTimestamp();
  const password = getPassword(timestamp);

  // M-Pesa expects the phone without the leading +
  const normalizedPhone = phone.replace(/^\+/, '');

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: normalizedPhone,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: normalizedPhone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef || bookingId,
    TransactionDesc: description || `KaziShow booking ${bookingId}`,
  };

  const res = await axios.post(
    `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log('💳 STK Push initiated:', res.data);
  return res.data;
}

async function querySTKStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const timestamp = getTimestamp();
  const password = getPassword(timestamp);

  const res = await axios.post(
    `${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return res.data;
}

async function b2c({ phone, amount, withdrawalId, remarks }) {
  const token = await getAccessToken();
  const normalizedPhone = phone.replace(/^\+/, '');

  const res = await axios.post(
    `${MPESA_BASE_URL}/mpesa/b2c/v3/paymentrequest`,
    {
      OriginatorConversationID: `WD-${withdrawalId}`,
      InitiatorName: process.env.MPESA_B2C_INITIATOR,
      SecurityCredential: process.env.MPESA_B2C_CREDENTIAL,
      CommandID: 'BusinessPayment',
      Amount: Math.round(amount),
      PartyA: process.env.MPESA_SHORTCODE,
      PartyB: normalizedPhone,
      Remarks: remarks || 'KaziShow payout',
      QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
      ResultURL: process.env.MPESA_B2C_RESULT_URL,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log('💸 B2C initiated:', res.data);
  return res.data;
}

module.exports = { stkPush, querySTKStatus, b2c };
