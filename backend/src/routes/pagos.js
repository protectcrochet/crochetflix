const express = require('express');
const router = express.Router();
const pagoController = require('../controllers/pagoController');
const { authMiddleware } = require('../middleware/auth');

router.post('/crear', authMiddleware, pagoController.crearPago);
router.post('/webhook', pagoController.webhook);
router.get('/estado/:orderId', authMiddleware, pagoController.verificarEstado);

module.exports = router;
