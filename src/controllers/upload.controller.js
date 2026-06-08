const { cloudinary } = require('../middleware/upload');

const VALID_FOLDERS = ['customers', 'ids', 'selfies', 'portfolio', 'businesses', 'posts', 'chat', 'covers', 'general', 'certificates'];

function safeFolder(raw) {
  const f = (raw || 'general').trim();
  return VALID_FOLDERS.includes(f) ? f : 'general';
}

function streamUpload(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

async function uploadImage(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }
    const folder = safeFolder(req.query.folder || req.body?.folder);
    const result = await streamUpload(req.file.buffer, {
      folder: `kazishow/${folder}`,
      resource_type: 'image',
    });
    res.json({ success: true, data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    console.error('❌ uploadImage error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

async function uploadImages(req, res) {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'No images provided' });
    }
    const folder = safeFolder(req.query.folder || req.body?.folder);
    const results = await Promise.all(
      req.files.map((f) => streamUpload(f.buffer, { folder: `kazishow/${folder}`, resource_type: 'image' }))
    );
    res.json({ success: true, data: results.map((r) => ({ url: r.secure_url, publicId: r.public_id })) });
  } catch (err) {
    console.error('❌ uploadImages error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

async function uploadPublic(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const folder = safeFolder(req.query.folder || req.body?.folder);
    const result = await streamUpload(req.file.buffer, {
      folder: `kazishow/${folder}`,
      resource_type: 'image',
    });
    res.json({ success: true, data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    console.error('❌ uploadPublic error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No document provided' });
    }
    const result = await streamUpload(req.file.buffer, {
      folder: 'kazishow/certificates',
      resource_type: 'auto',
    });
    res.json({ success: true, data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    console.error('❌ uploadDocument error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

async function uploadVideoFile(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No video provided' });
    }
    const result = await streamUpload(req.file.buffer, {
      folder: 'kazishow/videos',
      resource_type: 'video',
    });
    res.json({ success: true, data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    console.error('❌ uploadVideoFile error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

async function deleteImage(req, res) {
  try {
    const { publicId } = req.body;
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'publicId is required' });
    }
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true, data: { message: 'Image deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Delete failed' });
  }
}

async function uploadAudioFile(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No audio provided' });
    }
    const result = await streamUpload(req.file.buffer, {
      folder: 'kazishow/audio',
      resource_type: 'video', // Cloudinary uses 'video' resource_type for audio
    });
    res.json({ success: true, data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    console.error('❌ uploadAudioFile error:', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

module.exports = { uploadImage, uploadImages, deleteImage, uploadPublic, uploadDocument, uploadVideoFile, uploadAudioFile };
