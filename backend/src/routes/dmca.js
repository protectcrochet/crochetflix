const express = require('express');
const router = express.Router();
const db = require('../models');
const { Resend } = require('resend');

router.get('/', (req, res) => {
  db.all(`SELECT * FROM dmca_claims ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

router.post('/', (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const {
    patron_id,
    claimant_name, claimant_email, claimant_company, claimant_address,
    work_description, infringing_urls,
    proof_url, signature,
    good_faith, accuracy,
  } = req.body;

  if (!claimant_name || !claimant_email || !work_description || !infringing_urls || !signature) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const id = uuidv4();
  const ip = (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

  db.run(
    `INSERT INTO dmca_claims
      (id, patron_id, claimant_name, claimant_email, claimant_company, claimant_address,
       work_description, infringing_urls, proof_url, signature, good_faith, accuracy, ip_address)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, patron_id || null,
      claimant_name, claimant_email, claimant_company || null, claimant_address || null,
      work_description, infringing_urls, proof_url || null, signature,
      good_faith ? 1 : 0, accuracy ? 1 : 0, ip || null,
    ],
    function(err) {
      if (err) {
        console.error('[dmca] error INSERT:', err);
        return res.status(500).json({ error: 'Error interno' });
      }

      // Notificar al admin (no bloquea la respuesta)
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const FROM = process.env.RESEND_FROM_EMAIL || 'CrochetFlix <noreply@crochetflix.app>';
        resend.emails.send({
          from: FROM,
          to: process.env.ADMIN_EMAIL || 'crochetflix@proton.me',
          subject: `Nueva reclamación DMCA — ${claimant_name}`,
          html: `
            <h2>Nueva reclamación DMCA</h2>
            <p><strong>Reclamante:</strong> ${claimant_name} &lt;${claimant_email}&gt;</p>
            <p><strong>Patrón ID:</strong> ${patron_id || 'No especificado'}</p>
            <p><strong>URLs infractoras:</strong><br><pre>${infringing_urls}</pre></p>
            <p><strong>Descripción:</strong><br>${work_description}</p>
            <p><strong>URL de autoría:</strong> ${proof_url || 'No proporcionada'}</p>
            <p><strong>Firma:</strong> ${signature}</p>
            <hr><p>ID: <code>${id}</code></p>
          `.trim(),
        }).catch(e => console.error('[dmca] email error:', e.message));
      } catch (e) {
        console.error('[dmca] email setup error:', e.message);
      }

      res.json({ id, status: 'pending' });
    }
  );
});

router.patch('/:id', (req, res) => {
  const { status } = req.body;
  db.run(`UPDATE dmca_claims SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json({ success: true, status });
  });
});

module.exports = router;
