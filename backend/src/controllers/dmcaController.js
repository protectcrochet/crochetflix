const db = require('../models');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

function enviarEmailAdmin(claim) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to   = process.env.DMCA_EMAIL || process.env.SMTP_USER;
  if (!host || !user || !pass || !to) return;

  const transporter = nodemailer.createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  transporter.sendMail({
    from: `"CrochetFlix DMCA" <${user}>`,
    to,
    subject: `[DMCA] Nueva reclamación de ${claim.claimant_name}`,
    html: `
      <h2>Nueva reclamación DMCA recibida</h2>
      <p><strong>Nombre:</strong> ${claim.claimant_name}</p>
      <p><strong>Correo:</strong> ${claim.claimant_email}</p>
      <p><strong>Empresa:</strong> ${claim.claimant_company || '—'}</p>
      <p><strong>Obra reclamada:</strong> ${claim.work_description}</p>
      <p><strong>URLs infractoras:</strong><br>${claim.infringing_urls.replace(/\n/g, '<br>')}</p>
      <p><strong>IP:</strong> ${claim.ip_address}</p>
      <p><strong>Firma:</strong> ${claim.signature}</p>
      <hr>
      <p>Gestiona esta reclamación en el panel de administración.</p>
    `
  }).catch(e => console.error('[dmca] Error enviando email:', e.message));
}

exports.submitClaim = async (req, res) => {
  const {
    claimant_name, claimant_email, claimant_company, claimant_address,
    work_description, infringing_urls, patron_id,
    good_faith, accuracy, signature, proof_url
  } = req.body;

  if (!claimant_name || !claimant_email || !work_description || !infringing_urls || !signature) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }
  if (!good_faith || !accuracy) {
    return res.status(400).json({ error: 'Debes aceptar ambas declaraciones.' });
  }

  const id = uuidv4();
  const ip = req.ip || req.headers['x-forwarded-for'] || '';

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO dmca_claims (id, claimant_name, claimant_email, claimant_company, claimant_address,
        work_description, infringing_urls, patron_id, good_faith, accuracy, signature, ip_address, proof_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, claimant_name, claimant_email, claimant_company || null, claimant_address || null,
       work_description, infringing_urls, patron_id || null, 1, 1, signature, ip, proof_url || null],
      function(err) { if (err) reject(err); else resolve(); }
    );
  });

  const claim = { claimant_name, claimant_email, claimant_company, work_description, infringing_urls, signature, ip_address: ip };
  enviarEmailAdmin(claim);
  console.log(`[dmca] Nueva reclamación de ${claimant_email} — ID: ${id}`);

  res.json({ ok: true, id, message: 'Reclamación recibida. Tu solicitud será canalizada al área especializada para su revisión en un plazo de 3-5 días hábiles.' });
};

exports.listClaims = (req, res) => {
  db.all(
    `SELECT * FROM dmca_claims ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

exports.updateClaim = async (req, res) => {
  const { id } = req.params;
  const { status, admin_notes, restore_patron } = req.body;

  const claim = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM dmca_claims WHERE id = ?', [id], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  if (!claim) return res.status(404).json({ error: 'Reclamación no encontrada' });

  const resolved_at = ['resolved', 'rejected'].includes(status) ? new Date().toISOString() : null;

  db.run(
    `UPDATE dmca_claims SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes),
     resolved_at = COALESCE(?, resolved_at) WHERE id = ?`,
    [status || null, admin_notes || null, resolved_at, id],
    function(err) { if (err) return res.status(500).json({ error: err.message }); }
  );

  // Restaurar patrón si la reclamación fue rechazada o el admin decide restaurarlo
  if (restore_patron && claim.patron_id) {
    db.run(`UPDATE patrones SET activo = 1 WHERE id = ?`, [claim.patron_id], () => {});
  }

  res.json({ ok: true });
};
