const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../models');

const UPLOADS = path.join(__dirname, '../../../uploads/patrones');
const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos

function contarPdfsBot() {
  try {
    if (!fs.existsSync(UPLOADS)) return 0;
    return fs.readdirSync(UPLOADS).filter(f => f.endsWith('.pdf')).length;
  } catch { return 0; }
}

function contarPendientes(cb) {
  db.get(
    `SELECT COUNT(*) as n FROM patrones WHERE activo = 1 AND paginas = 0`,
    [],
    (err, row) => cb(err ? 0 : (row?.n || 0))
  );
}

function contarCorruptos(cb) {
  db.get(
    `SELECT COUNT(*) as n FROM patrones WHERE pdf_corrupto = 1`,
    [],
    (err, row) => cb(err ? 0 : (row?.n || 0))
  );
}

function bajarVencidos() {
  db.run(
    `UPDATE users SET tier = 'free', subscription_expires_at = NULL
     WHERE tier = 'premium' AND subscription_expires_at IS NOT NULL
       AND subscription_expires_at < datetime('now')`,
    [],
    function(err) {
      if (err) { console.error('[worker] Error bajando vencidos:', err.message); return; }
      if (this.changes > 0) console.log(`[worker] ${this.changes} suscripción(es) vencida(s) → free`);
    }
  );
}

function autoGroq() {
  const { groqRunning } = require('../routes/admin');
  if (groqRunning) return; // ya está corriendo

  db.get(
    `SELECT COUNT(*) as n FROM patrones
     WHERE activo = 1 AND paginas > 0
       AND (titulo IS NULL OR titulo = '' OR titulo LIKE '%.pdf' OR titulo LIKE '%patron-%'
            OR diseñadora IS NULL OR diseñadora = '')`,
    [],
    (err, row) => {
      if (err || !row?.n) return;
      const pendientes = row.n;
      if (pendientes === 0) return;

      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret) return;

      console.log(`[worker] ${pendientes} patrones sin metadata — disparando Groq automático`);
      axios.post('http://localhost:3001/api/admin/patrones/extraer-metadatos-groq', {}, {
        headers: { 'x-admin-secret': adminSecret },
        timeout: 5000,
      }).catch(err => console.error('[worker] Error disparando Groq:', err.message));
    }
  );
}

function ciclo() {
  bajarVencidos();
  autoGroq();
  const pdfsBot = contarPdfsBot();
  contarPendientes(pendientes => {
    contarCorruptos(corruptos => {
      const nuevos = 0;
      console.log(`[worker] Ciclo — PDFs bot: ${pdfsBot}, nuevos: ${nuevos}, pendientes: ${pendientes}, corruptos: ${corruptos}`);
    });
  });
}

function iniciar() {
  ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

module.exports = { iniciar };
