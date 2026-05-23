const express = require('express');
const router = express.Router();
const viewerController = require('../controllers/viewerController');
const authMiddleware = require('../middleware/auth');

router.get('/pagina/:patronId/:paginaNum', authMiddleware, viewerController.getPagina);
router.post('/progreso', authMiddleware, viewerController.guardarProgreso);
router.post('/completar', authMiddleware, viewerController.completar);
router.post('/offline', authMiddleware, viewerController.toggleOffline);

module.exports = router;