const express = require('express');
const router = express.Router();
const db = require('../models');

// Tabla dmca_claims (creada si no existe)
db.run(`CREATE TABLE IF NOT EXISTS dmca_claims (
  id TEXT PRIMARY KEY,
  patron_id TEXT,
  nombre_reclamante TEXT,
  email TEXT,
  descripcion TEXT,
  estado TEXT DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

router.get('/', (req, res) => {
  db.all(`SELECT * FROM dmca_claims ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

router.post('/', (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const { patron_id, nombre_reclamante, email, descripcion } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO dmca_claims (id, patron_id, nombre_reclamante, email, descripcion) VALUES (?,?,?,?,?)`,
    [id, patron_id, nombre_reclamante, email, descripcion],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error interno' });
      res.json({ id, estado: 'pendiente' });
    }
  );
});

router.patch('/:id', (req, res) => {
  const { estado } = req.body;
  db.run(`UPDATE dmca_claims SET estado = ? WHERE id = ?`, [estado, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json({ success: true, estado });
  });
});

module.exports = router;
