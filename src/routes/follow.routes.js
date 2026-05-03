const router = require('express').Router();
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/follow.controller');

router.put('/:providerId', auth, ctrl.toggleFollow);

module.exports = router;
