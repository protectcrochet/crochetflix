const express = require('express');
const router = express.Router();
const viewerController = require('../controllers/viewerController');
const { authMiddleware, requireEmailVerified } = require('../middleware/auth');

router.get('/pagina/:patronId/:paginaNum', authMiddleware, requireEmailVerified, viewerController.getPagina);
router.post('/progreso', authMiddleware, requireEmailVerified, viewerController.guardarProgreso);
router.post('/completar', authMiddleware, requireEmailVerified, viewerController.completar);
router.post('/offline', authMiddleware, requireEmailVerified, viewerController.toggleOffline);

module.exports = router;