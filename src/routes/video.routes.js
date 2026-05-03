const router = require('express').Router();
const { auth, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/video.controller');

// Public / optional-auth
router.get('/',                       optionalAuth, ctrl.getVideos);
router.get('/:id/comments',           ctrl.getComments);

// Auth required — static paths before /:id
router.post('/',                      auth, ctrl.postVideo);
router.get('/my',                     auth, ctrl.getMyVideos);
router.get('/booked-providers',       auth, ctrl.getBookedProviders);

// Auth required — parameterised paths
router.delete('/:id',                 auth, ctrl.deleteVideo);
router.put('/:id/like',               auth, ctrl.likeVideo);
router.post('/:id/comments',          auth, ctrl.addComment);
router.post('/:id/report',            auth, ctrl.reportVideo);

module.exports = router;
