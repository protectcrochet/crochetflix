const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const adminController = require('../controllers/adminController');

// Verificar ADMIN_SECRET en el header
function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Admin no configurado (falta ADMIN_SECRET en .env)' });
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
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

router.get('/patrones', adminController.listarPatrones);
router.get('/patrones/exportar', adminController.exportarCSV);
router.post('/patrones/sincronizar', adminController.sincronizarPDFs);
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
router.patch('/patrones/:id/toggle', adminController.toggleActivo);
router.delete('/patrones/:id', adminController.eliminarPatron);

module.exports = router;
