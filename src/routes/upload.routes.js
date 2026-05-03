const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { upload, uploadDoc, uploadVideo } = require('../middleware/upload');
const ctrl = require('../controllers/upload.controller');

// Public upload for registration (no auth required)
router.post('/public', upload.single('image'), ctrl.uploadPublic);

// Protected image upload for logged-in users
router.post('/image', auth, upload.single('image'), ctrl.uploadImage);
router.post('/images', auth, upload.array('images', 6), ctrl.uploadImages);
router.delete('/image', auth, ctrl.deleteImage);

// Certificate/document upload (image or PDF)
router.post('/document', auth, uploadDoc.single('file'), ctrl.uploadDocument);
router.post('/public-document', uploadDoc.single('file'), ctrl.uploadDocument);

// Portfolio video upload
router.post('/video', auth, uploadVideo.single('video'), ctrl.uploadVideoFile);
router.post('/public-video', uploadVideo.single('video'), ctrl.uploadVideoFile);

module.exports = router;
