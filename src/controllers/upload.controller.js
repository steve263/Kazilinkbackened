const { cloudinary } = require('../middleware/upload');

async function uploadImage(req, res) {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }
    res.json({
      success: true,
      data: { url: req.file.path, publicId: req.file.filename },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
}

async function uploadImages(req, res) {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'No images provided' });
    }
    const images = req.files.map((f) => ({ url: f.path, publicId: f.filename }));
    res.json({ success: true, data: images });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Upload failed' });
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
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
}

async function uploadPublic(req, res) {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    res.json({ success: true, data: { url: req.file.path, publicId: req.file.filename } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'No document provided' });
    }
    res.json({ success: true, data: { url: req.file.path, publicId: req.file.filename } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function uploadVideoFile(req, res) {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'No video provided' });
    }
    res.json({ success: true, data: { url: req.file.path, publicId: req.file.filename } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { uploadImage, uploadImages, deleteImage, uploadPublic, uploadDocument, uploadVideoFile };
