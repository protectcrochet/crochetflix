const express = require('express');
const router = express.Router();
const patronController = require('../controllers/patronController');
const authMiddleware = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// Público — auth opcional para personalizar resultados
router.get('/', optionalAuth, patronController.listar);
router.get('/:id', optionalAuth, patronController.detalle);

// Protegido
router.post('/mi-lista', authMiddleware, patronController.toggleMiLista);
router.post('/:id/traducir', authMiddleware, patronController.traducir);

module.exports = router;