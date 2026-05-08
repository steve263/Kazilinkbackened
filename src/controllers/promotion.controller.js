const prisma = require('../config/db');

const now = () => new Date();

async function createPromotion(req, res) {
  try {
    const { title, description, discountType, discountValue, endDate } = req.body;
    if (!title || !discountValue || !endDate) {
      return res.status(400).json({ success: false, message: 'title, discountValue and endDate are required' });
    }
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const promo = await prisma.promotion.create({
      data: {
        providerId: provider.id,
        title,
        description,
        discountType: discountType || 'PERCENTAGE',
        discountValue: parseFloat(discountValue),
        endDate: new Date(endDate),
      },
    });
    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyPromotions(req, res) {
  try {
    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const promos = await prisma.promotion.findMany({
      where: { providerId: provider.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deletePromotion(req, res) {
  try {
    const promo = await prisma.promotion.findUnique({ where: { id: req.params.id } });
    if (!promo) return res.status(404).json({ success: false, message: 'Promotion not found' });

    const provider = await prisma.provider.findUnique({ where: { userId: req.user.id } });
    if (!provider || promo.providerId !== provider.id) {
      return res.status(403).json({ success: false, message: 'Not your promotion' });
    }
    await prisma.promotion.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Promotion deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getActiveDeals(req, res) {
  try {
    const promos = await prisma.promotion.findMany({
      where: { isActive: true, endDate: { gt: now() }, startDate: { lte: now() } },
      include: {
        provider: {
          select: {
            id: true, businessName: true, category: true, rating: true,
            profileImage: true,
            user: { select: { location: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { createPromotion, getMyPromotions, deletePromotion, getActiveDeals };
