const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pagoController = require('../controllers/pagoController');

// Checkout — usado por Viewer.jsx; delega a pagoController
router.post('/checkout', authMiddleware, ...pagoController.crearPago);

// Webhook real de Stripe
router.post('/webhook', ...pagoController.webhook);

module.exports = router;
