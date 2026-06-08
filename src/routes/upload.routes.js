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

// Background audio upload for ShowReel
router.post('/audio', auth, uploadVideo.single('audio'), ctrl.uploadAudioFile);

// Catch multer / Cloudinary errors and return JSON instead of crashing
router.use((err, req, res, next) => {
  console.error('📁 Upload error:', err.message || err);
  res.status(err.http_code || err.status || 400).json({
    success: false,
    message: err.message || 'Upload failed',
  });
});

module.exports = router;
