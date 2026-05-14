const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/recommendations.controller');

router.get('/',            auth,         ctrl.getRecommendations);
router.post('/interaction', auth,         ctrl.recordInteraction);
router.get('/trending',    optionalAuth, ctrl.getTrending);
router.get('/nearby',      optionalAuth, ctrl.getNearby);

module.exports = router;
