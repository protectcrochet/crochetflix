const express = require('express');
const router = express.Router();
const patronController = require('../controllers/patronController');
const authMiddleware = require('../middleware/auth');
const authOptional = require('../middleware/authOptional');

// Público con auth opcional (para saber favoritos/progreso del usuario)
router.get('/', authOptional, patronController.listar);
router.get('/:id', authOptional, patronController.detalle);

// Protegido
router.post('/mi-lista', authMiddleware, patronController.toggleMiLista);

module.exports = router;