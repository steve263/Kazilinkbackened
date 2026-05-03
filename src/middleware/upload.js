const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Image upload ─────────────────────────────────────────────────────────────

const VALID_FOLDERS = ['customers', 'ids', 'selfies', 'portfolio', 'businesses', 'posts', 'chat', 'covers', 'general', 'certificates'];

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => {
    const requested = req.query.folder || req.body?.folder || 'general';
    const folder = VALID_FOLDERS.includes(requested) ? requested : 'general';
    return {
      folder: `kazishow/${folder}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
    };
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, and WebP files are allowed'), false);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

// ─── Document upload (images + PDF for certificates) ─────────────────────────

const docStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kazishow/certificates',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
  },
});

const docFileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed'), false);
};

const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: docFileFilter,
});

// ─── Video upload ─────────────────────────────────────────────────────────────

const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kazishow/videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'mov', 'webm'],
  },
});

const videoFileFilter = (req, file, cb) => {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only MP4, MOV, and WebM video files are allowed'), false);
};

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: videoFileFilter,
});

module.exports = { upload, uploadDoc, uploadVideo, cloudinary };
