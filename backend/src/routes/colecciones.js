const express = require('express');
const router = express.Router();
const db = require('../models');

// Tabla colecciones (creada si no existe)
db.run(`CREATE TABLE IF NOT EXISTS colecciones (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  portada_url TEXT,
  orden INTEGER DEFAULT 0,
  activa BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS coleccion_patrones (
  coleccion_id TEXT NOT NULL,
  patron_id TEXT NOT NULL,
  orden INTEGER DEFAULT 0,
  PRIMARY KEY (coleccion_id, patron_id)
)`);

router.get('/', (req, res) => {
  db.all(`SELECT * FROM colecciones WHERE activa = 1 ORDER BY orden ASC, created_at DESC`, [], (err, cols) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    if (!cols || cols.length === 0) return res.json([]);

    let pendientes = cols.length;
    const resultado = cols.map(c => ({ ...c, patrones: [] }));

    resultado.forEach((col, i) => {
      db.all(
        `SELECT p.* FROM patrones p
         JOIN coleccion_patrones cp ON cp.patron_id = p.id
         WHERE cp.coleccion_id = ? AND p.activo = 1
         ORDER BY cp.orden ASC`,
        [col.id],
        (err2, patrones) => {
          resultado[i].patrones = patrones || [];
          if (--pendientes === 0) res.json(resultado);
        }
      );
    });
  });
});

router.get('/:id', (req, res) => {
  db.get(`SELECT * FROM colecciones WHERE id = ?`, [req.params.id], (err, col) => {
    if (err || !col) return res.status(404).json({ error: 'No encontrada' });
    db.all(
      `SELECT p.* FROM patrones p
       JOIN coleccion_patrones cp ON cp.patron_id = p.id
       WHERE cp.coleccion_id = ? ORDER BY cp.orden ASC`,
      [req.params.id],
      (err2, patrones) => {
        res.json({ ...col, patrones: patrones || [] });
      }
    );
  });
});

router.post('/', (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const { nombre, descripcion, portada_url, orden } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO colecciones (id, nombre, descripcion, portada_url, orden) VALUES (?,?,?,?,?)`,
    [id, nombre, descripcion || '', portada_url || '', orden || 0],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ id, nombre });
    }
  );
});

router.patch('/:id', (req, res) => {
  const { nombre, descripcion, portada_url, orden, activa } = req.body;
  db.run(
    `UPDATE colecciones SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion),
     portada_url=COALESCE(?,portada_url), orden=COALESCE(?,orden), activa=COALESCE(?,activa)
     WHERE id=?`,
    [nombre, descripcion, portada_url, orden, activa, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ success: true });
    }
  );
});

router.delete('/:id', (req, res) => {
  db.run(`DELETE FROM coleccion_patrones WHERE coleccion_id = ?`, [req.params.id], () => {
    db.run(`DELETE FROM colecciones WHERE id = ?`, [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ success: true });
    });
  });
});

router.post('/:id/patrones', (req, res) => {
  const { patron_id, orden } = req.body;
  db.run(
    `INSERT OR IGNORE INTO coleccion_patrones (coleccion_id, patron_id, orden) VALUES (?,?,?)`,
    [req.params.id, patron_id, orden || 0],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ success: true });
    }
  );
});

router.delete('/:id/patrones/:patron_id', (req, res) => {
  db.run(
    `DELETE FROM coleccion_patrones WHERE coleccion_id=? AND patron_id=?`,
    [req.params.id, req.params.patron_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ success: true });
    }
  );
});

module.exports = router;
