const fs = require('fs');
const path = require('path');
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

function ciclo() {
  const pdfsBot = contarPdfsBot();
  contarPendientes(pendientes => {
    contarCorruptos(corruptos => {
      const nuevos = 0; // procesados en tiempo real por el endpoint POST /patrones
      console.log(`[worker] Ciclo — PDFs bot: ${pdfsBot}, nuevos: ${nuevos}, pendientes: ${pendientes}, corruptos: ${corruptos}`);
    });
  });
}

function iniciar() {
  ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

module.exports = { iniciar };
