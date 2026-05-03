const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/message.controller');

// Specific routes must come before /:userId
router.get('/conversations', auth, ctrl.getConversations);
router.get('/unread/count', auth, ctrl.getUnreadCount);
router.get('/user-info/:userId', auth, ctrl.getUserInfo);
router.post('/upload', auth, upload.single('image'), ctrl.uploadImage);

router.get('/:userId', auth, ctrl.getMessages);
router.post('/', auth, ctrl.sendMessage);
router.put('/:userId/read', auth, ctrl.markAsRead);
router.delete('/:messageId', auth, ctrl.deleteMessage);

module.exports = router;
