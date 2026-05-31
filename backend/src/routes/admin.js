const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const adminController = require('../controllers/adminController');
const dmcaController = require('../controllers/dmcaController');

// Verificar ADMIN_SECRET en el header
function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Admin no configurado (falta ADMIN_SECRET en .env)' });
  }
  const adminSecret = req.headers['x-admin-secret'];
  if (!adminSecret || adminSecret !== secret) {
    return res.status(401).json({ error: 'Acceso denegado' });
  }
  next();
}

// Multer: guarda temporalmente en /tmp
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max por archivo
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Tipo de archivo no permitido: ${ext}`));
  }
});

const uploadFields = upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'imagenes', maxCount: 100 }
]);

const uploadCSV = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') cb(null, true);
    else cb(new Error('Solo se aceptan archivos .csv'));
  }
}).single('csv');

router.use(adminAuth);

router.get('/stats', adminController.stats);
router.get('/analytics', adminController.analytics);
router.post('/patrones/normalizar-categorias', adminController.normalizarCategorias);
router.post('/patrones/extraer-metadatos', adminController.extraerDiseñadoras);
router.get('/patrones', adminController.listarPatrones);
router.get('/patrones/exportar', adminController.exportarCSV);
router.post('/patrones/sincronizar', adminController.sincronizarPDFs);
router.post('/patrones/reparar-thumbnails', adminController.repararThumbnails);
router.post('/patrones/fix-autor', adminController.fixAutorTelegram);
router.post('/patrones/extraer-metadatos-fondo', adminController.extraerMetadatosFondo);
router.post('/patrones/extraer-metadatos-groq', adminController.extraerMetadatosGroqFondo);
router.post('/patrones/categorizar-fondo', adminController.categorizarFondo);
router.post('/patrones/categorizar', adminController.categorizarConIA);
router.post('/patrones/importar', (req, res, next) => {
  uploadCSV(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, adminController.importarCSV);
router.post('/patrones', (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, adminController.crearPatron);
router.patch('/patrones/:id', adminController.editarPatron);
router.patch('/patrones/:id/toggle', adminController.toggleActivo);
router.patch('/patrones/:id/destacar', adminController.toggleDestacado);
router.patch('/patrones/:id/tendencia', adminController.toggleTendencia);
router.patch('/patrones/:id/verificar', adminController.toggleVerificado);
router.patch('/patrones/:id/corrupto', adminController.toggleCorrupto);
router.patch('/patrones/:id/hero-position', adminController.guardarHeroPosition);
router.delete('/patrones/:id', adminController.eliminarPatron);

router.get('/usuarios', adminController.listarUsuarios);
router.get('/usuarios/:id', adminController.verUsuario);
router.patch('/usuarios/:id/tier', adminController.cambiarTierUsuario);
router.delete('/usuarios/:id', adminController.eliminarUsuario);
router.get('/dmca', dmcaController.listClaims);
router.patch('/dmca/:id', dmcaController.updateClaim);

module.exports = router;
