require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { initSocket } = require('./config/socket');

const app = express();
const server = http.createServer(app);

// ─── Socket.io (must init before routes so services can call getIo) ───────────
initSocket(server);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Root + health ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'KaziShow API',
    version: '1.0.0',
    description: "Kenya's all-in-one service marketplace",
    endpoints: {
      auth:          '/api/auth',
      providers:     '/api/providers',
      customers:     '/api/customers',
      bookings:      '/api/bookings',
      notifications: '/api/notifications',
      payments:      '/api/payments',
      reviews:       '/api/reviews',
      posts:         '/api/posts',
      follows:       '/api/follows',
      testimonials:  '/api/testimonials',
      tips:          '/api/tips',
      videos:        '/api/videos',
      health:        '/health',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'KaziShow API is running', timestamp: new Date().toISOString() });
});

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/providers',     require('./routes/provider.routes'));
app.use('/api/customers',     require('./routes/customer.routes'));
app.use('/api/bookings',      require('./routes/booking.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/payments',      require('./routes/payment.routes'));
app.use('/api/posts',         require('./routes/post.routes'));
app.use('/api/follows',       require('./routes/follow.routes'));
app.use('/api/admin',         require('./routes/admin.routes'));
app.use('/api/messages',      require('./routes/message.routes'));
app.use('/api/upload',        require('./routes/upload.routes'));
app.use('/api/testimonials',  require('./routes/testimonial.routes'));
app.use('/api/tips',          require('./routes/tip.routes'));
app.use('/api/stats',         require('./routes/stats.routes'));
app.use('/api/videos',        require('./routes/video.routes'));

// Review routes (convenience aliases at /api/reviews)
const { auth: _auth, requireRole: _role } = require('./middleware/auth');
const _cc = require('./controllers/customer.controller');
const _prisma = require('./config/db');
// Public: all reviews (for home page Real Stories section)
app.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await _prisma.review.findMany({
      include: {
        customer: { select: { id: true, name: true, profilePhoto: true } },
        provider: { select: { id: true, businessName: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ success: true, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post('/api/reviews',                             _auth, _role('CUSTOMER'), _cc.createReview);
app.get('/api/reviews/my',                           _auth, _role('CUSTOMER'), _cc.getMyReviews);
app.get('/api/reviews/check/:providerId',            _auth, _role('CUSTOMER'), _cc.getReviewableBooking);
app.get('/api/reviews/provider/:id',                 _cc.getProviderReviews);
app.put('/api/reviews/:id/helpful',                  _auth, _cc.markHelpful);
app.put('/api/reviews/:id',                          _auth, _role('CUSTOMER'), _cc.updateReview);
app.delete('/api/reviews/:id',                       _auth, _role('CUSTOMER'), _cc.deleteReview);

// ─── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 KaziShow Backend running on port', PORT);
  console.log('📊 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Health:', `http://localhost:${PORT}/health`);
  console.log('');
});

module.exports = { app, server };
