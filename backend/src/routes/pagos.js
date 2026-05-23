const express = require('express');
const router = express.Router();
const pagoController = require('../controllers/pagoController');
const authMiddleware = require('../middleware/auth');

// Crear orden de pago (protegido)
router.post('/crear', authMiddleware, pagoController.crearPago);

// Webhook de NOWPayments (público, verificación por firma)
router.post('/webhook', pagoController.webhook);

// Verificar estado de pago (protegido)
router.get('/estado/:orderId', authMiddleware, pagoController.verificarEstado);

module.exports = router;