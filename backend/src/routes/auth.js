const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/me', authMiddleware, authController.me);
router.get('/stats', authMiddleware, authController.stats);
router.get('/historial', authMiddleware, authController.historial);
router.get('/referidos', authMiddleware, authController.referidos);
router.get('/admin-token', authMiddleware, authController.adminToken);
router.get('/unsub', adminController.unsubscribe);

module.exports = router;