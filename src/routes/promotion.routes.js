const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const c = require('../controllers/promotion.controller');

router.get('/active',    c.getActiveDeals);
router.get('/my',        auth, requireRole('PROVIDER'), c.getMyPromotions);
router.post('/',         auth, requireRole('PROVIDER'), c.createPromotion);
router.delete('/:id',    auth, requireRole('PROVIDER'), c.deletePromotion);

module.exports = router;
