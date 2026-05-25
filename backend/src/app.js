const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const authRoutes = require('./routes/auth');
const patronesRoutes = require('./routes/patrones');
const viewerRoutes = require('./routes/viewer');
const pagosRoutes = require('./routes/pagos');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('trust proxy', 1); // Required for rate limiting behind nginx

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret']
}));

// JSON parser con captura de rawBody para webhooks (HMAC verification)
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    if (req.path && req.path.includes('/webhook')) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// Archivos subidos (thumbnails e imágenes de patrones)
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/patrones', patronesRoutes);
app.use('/api/viewer', viewerRoutes);
app.use('/api/pagos', pagosRoutes);

app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;