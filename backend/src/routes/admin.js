const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function verifyAdmin(req, res, next) {
  const authHeader = req.headers['x-admin-secret'] || req.body.adminSecret;
  
  if (!ADMIN_SECRET) {
    return res.status(500).json({ error: 'ADMIN_SECRET no configurado' });
  }
  
  if (authHeader !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/patrones');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/patrones', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún PDF' });
    }

    const { titulo, descripcion, categoria, esPremium } = req.body;
    
    if (!titulo || !categoria) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Título y categoría son obligatorios' });
    }

    const id = uuidv4();
    const pdfPath = req.file.path;
    const pdfFilename = req.file.filename;
    
    const { fromPath } = require('pdf2pic');
    const uploadDir = path.join(__dirname, '../../uploads/patrones');
    const imagenesDir = path.join(uploadDir, 'imagenes', id);
    
    if (!fs.existsSync(imagenesDir)) {
      fs.mkdirSync(imagenesDir, { recursive: true });
    }

    const options = {
      density: 150,
      saveFilename: 'page',
      savePath: imagenesDir,
      format: 'png',
      width: 1200,
      height: 1600
    };

    const convert = fromPath(pdfPath, options);
    const response = await convert.bulk(-1);
    
    const totalPaginas = response.length;
    const imagenes = response.map((img, index) => ({
      pagina: index + 1,
      url: `/uploads/patrones/imagenes/${id}/page_${index + 1}.png`
    }));

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO patrones (id, titulo, descripcion, categoria, es_premium, pdf_filename, total_paginas, imagenes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, titulo, descripcion, categoria, esPremium === 'true' ? 1 : 0, pdfFilename, totalPaginas, JSON.stringify(imagenes)],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    res.json({
      success: true,
      patron: { id, titulo, categoria, totalPaginas, esPremium: esPremium === 'true' }
    });

  } catch (err) {
    console.error('Error subiendo patrón:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Error procesando el patrón' });
  }
});

router.get('/patrones', verifyAdmin, async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, titulo, categoria, es_premium, total_paginas, created_at FROM patrones ORDER BY created_at DESC',
        [],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows);
        }
      );
    });
    res.json({ patrones });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/patrones/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT pdf_filename FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!patron) {
      return res.status(404).json({ error: 'Patrón no encontrado' });
    }

    const uploadDir = path.join(__dirname, '../../uploads/patrones');
    const pdfPath = path.join(uploadDir, patron.pdf_filename);
    const imagenesDir = path.join(uploadDir, 'imagenes', id);

    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(imagenesDir)) {
      fs.rmSync(imagenesDir, { recursive: true, force: true });
    }

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM patrones WHERE id = ?', [id], function(err) {
        if (err) reject(err);
        resolve();
      });
    });

    res.json({ success: true, message: 'Patrón eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE tier = 'premium') as premium_users,
          (SELECT COUNT(*) FROM patrones) as total_patrones,
          (SELECT COUNT(*) FROM pagos WHERE status = 'finished') as pagos_completados`,
        [],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;