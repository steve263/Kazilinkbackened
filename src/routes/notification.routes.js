const express = require('express');
const router = express.Router();
const { getNotifications, getUnreadCount, markRead, markAllRead, deleteNotification } = require('../controllers/notification.controller');
const { auth } = require('../middleware/auth');

router.get('/unread/count', auth, getUnreadCount);
router.get('/', auth, getNotifications);
router.put('/read-all', auth, markAllRead);
router.put('/:id/read', auth, markRead);
router.delete('/:id', auth, deleteNotification);

module.exports = router;
