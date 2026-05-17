const express = require('express');
const router = express.Router();
const { stkPush, mpesaCallback, getPaymentStatus, getMyPayments, checkPaymentStatus } = require('../controllers/payment.controller');
const { auth } = require('../middleware/auth');

// M-Pesa callback is public (called by Safaricom servers)
router.post('/callback', mpesaCallback);

router.post('/stk-push', auth, stkPush);
router.get('/my', auth, getMyPayments);
router.get('/check/:bookingId', auth, checkPaymentStatus);
router.get('/:bookingId', auth, getPaymentStatus);

module.exports = router;
