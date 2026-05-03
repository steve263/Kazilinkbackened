const router = require('express').Router();
const { auth, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/post.controller');

router.get('/my', auth, ctrl.getMyPosts);
router.get('/', optionalAuth, ctrl.getPosts);
router.post('/', auth, ctrl.createPost);
router.delete('/:id', auth, ctrl.deletePost);
router.put('/:id/like', auth, ctrl.toggleLike);
router.get('/:id/comments', ctrl.getComments);
router.post('/:id/comments', auth, ctrl.addComment);

module.exports = router;
