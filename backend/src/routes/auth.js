const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.me);
router.get('/historial', authMiddleware, authController.historial);
router.get('/referidos', authMiddleware, authController.referidos);
router.get('/verificar-email', authController.verificarEmail);
router.post('/reenviar-verificacion', authMiddleware, authController.reenviarVerificacion);

module.exports = router;
