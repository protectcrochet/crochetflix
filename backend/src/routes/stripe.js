const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pagoController = require('../controllers/pagoController');

// Checkout — usado por Viewer.jsx; delega a pagoController
router.post('/checkout', authMiddleware, ...pagoController.crearPago);

// Webhook real de Stripe (manejado por pagos/webhook)
router.post('/webhook', (req, res) => {
  res.json({ received: true });
});

module.exports = router;
