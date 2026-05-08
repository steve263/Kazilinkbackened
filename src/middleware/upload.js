const multer = require('multer');
const cloudinary = require('cloudinary').v2;

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ CLOUDINARY credentials missing — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Memory storage — controller uploads buffer to Cloudinary directly ────────

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, and WebP images are allowed'), false);
};

const docFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed'), false);
};

const videoFilter = (req, file, cb) => {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only MP4, MOV, and WebM videos are allowed'), false);
};

const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5   * 1024 * 1024 }, fileFilter: imageFilter });
const uploadDoc   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10  * 1024 * 1024 }, fileFilter: docFilter   });
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: videoFilter });

module.exports = { upload, uploadDoc, uploadVideo, cloudinary };
