const express = require('express');
const router = express.Router();
const db = require('../models');
const { Resend } = require('resend');

// Tabla dmca_claims (creada si no existe)
db.run(`CREATE TABLE IF NOT EXISTS dmca_claims (
  id TEXT PRIMARY KEY,
  patron_id TEXT,
  nombre_reclamante TEXT,
  email TEXT,
  descripcion TEXT,
  infringing_urls TEXT,
  proof_url TEXT,
  signature TEXT,
  estado TEXT DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// Agregar columnas nuevas si la tabla ya existía sin ellas
['infringing_urls', 'proof_url', 'signature'].forEach(col => {
  db.run(`ALTER TABLE dmca_claims ADD COLUMN ${col} TEXT`, () => {});
});

router.get('/', (req, res) => {
  db.all(`SELECT * FROM dmca_claims ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

router.post('/', async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const {
    patron_id,
    claimant_name, claimant_email,
    work_description, infringing_urls,
    proof_url, signature,
  } = req.body;

  if (!claimant_name || !claimant_email || !work_description) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const id = uuidv4();

  db.run(
    `INSERT INTO dmca_claims (id, patron_id, nombre_reclamante, email, descripcion, infringing_urls, proof_url, signature)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, patron_id || null, claimant_name, claimant_email, work_description, infringing_urls || null, proof_url || null, signature || null],
    function(err) {
      if (err) {
        console.error('[dmca] error INSERT:', err);
        return res.status(500).json({ error: 'Error interno' });
      }

      // Notificar al admin por email (no bloquea la respuesta)
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const FROM = process.env.RESEND_FROM_EMAIL || 'CrochetFlix <noreply@crochetflix.app>';
        resend.emails.send({
          from: FROM,
          to: process.env.ADMIN_EMAIL || 'kroshapattern@gmail.com',
          subject: `Nueva reclamación DMCA — ${claimant_name}`,
          html: `
            <h2>Nueva reclamación DMCA recibida</h2>
            <p><strong>Reclamante:</strong> ${claimant_name} &lt;${claimant_email}&gt;</p>
            <p><strong>Patrón ID:</strong> ${patron_id || 'No especificado'}</p>
            <p><strong>URLs infractoras:</strong><br><pre>${infringing_urls || 'No especificado'}</pre></p>
            <p><strong>Descripción de la obra:</strong><br>${work_description}</p>
            <p><strong>URL de prueba de autoría:</strong> ${proof_url || 'No proporcionada'}</p>
            <p><strong>Firma:</strong> ${signature || 'No proporcionada'}</p>
            <hr>
            <p>ID de reclamación: <code>${id}</code></p>
          `.trim(),
        }).catch(e => console.error('[dmca] email error:', e.message));
      } catch (e) {
        console.error('[dmca] email setup error:', e.message);
      }

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
