const express = require('express');
const router = express.Router();
const pagoController = require('../controllers/pagoController');
const authMiddleware = require('../middleware/auth');

// Crear sesión de pago Stripe (protegido)
router.post('/crear', authMiddleware, pagoController.crearPago);

// Webhook de Stripe (público, verificación por firma HMAC)
router.post('/webhook', pagoController.webhook);

// Verificar estado de pago (protegido)
router.get('/estado/:orderId', authMiddleware, pagoController.verificarEstado);

module.exports = router;
