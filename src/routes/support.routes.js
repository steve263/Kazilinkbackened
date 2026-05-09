const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/support.controller');

router.post('/ai-chat', ctrl.aiChat);

module.exports = router;
