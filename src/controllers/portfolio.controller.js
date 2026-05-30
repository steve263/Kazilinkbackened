const prisma = require('../config/db');
const { cloudinary } = require('../middleware/upload');
const { randomUUID } = require('crypto');

async function getPosts(req, res) {
  try {
    const posts = await prisma.portfolioPost.findMany({
      where: { providerId: req.params.providerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: posts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createPost(req, res) {
  try {
    const { title, description, price } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) {
      return res.status(403).json({ success: false, message: 'Provider profile not found' });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'kazishow/portfolio', transformation: [{ width: 800, height: 800, crop: 'fill' }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      ).end(req.file.buffer);
    });

    const post = await prisma.portfolioPost.create({
      data: {
        id: randomUUID(),
        providerId: provider.id,
        title: title.trim(),
        description: description?.trim() || '',
        price: price ? parseFloat(price) : null,
        imageUrl: uploadResult.secure_url,
      },
    });

    console.log(`📸 Portfolio post created: ${post.title} by ${provider.businessName}`);
    res.json({ success: true, data: post });
  } catch (err) {
    console.error('createPost error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updatePost(req, res) {
  try {
    const { postId } = req.params;
    const { title, description, price } = req.body;

    const existing = await prisma.portfolioPost.findUnique({ where: { id: postId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Post not found' });

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider || existing.providerId !== provider.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const post = await prisma.portfolioPost.update({
      where: { id: postId },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        price: price !== undefined ? (price ? parseFloat(price) : null) : existing.price,
        updatedAt: new Date(),
      },
    });

    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deletePost(req, res) {
  try {
    const { postId } = req.params;

    const existing = await prisma.portfolioPost.findUnique({ where: { id: postId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Post not found' });

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider || existing.providerId !== provider.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.portfolioPost.update({
      where: { id: postId },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getPosts, createPost, updatePost, deletePost };
