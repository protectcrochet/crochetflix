const express = require('express');
const router = express.Router();
const patronController = require('../controllers/patronController');
const authMiddleware = require('../middleware/auth');

// Público (con auth opcional para preview)
router.get('/', authMiddleware, patronController.listar);
router.get('/:id', authMiddleware, patronController.detalle);

// Protegido
router.post('/mi-lista', authMiddleware, patronController.toggleMiLista);
router.post('/:id/traducir', authMiddleware, patronController.traducir);

module.exports = router;