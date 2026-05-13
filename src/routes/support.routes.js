const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/support.controller');

router.post('/ai-chat', ctrl.aiChat);
router.post('/contact', ctrl.contactForm);

module.exports = router;
