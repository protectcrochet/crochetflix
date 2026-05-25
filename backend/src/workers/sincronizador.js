const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads/patrones');
const INTERVALO_MS = 5 * 60 * 1000; // cada 5 minutos
const BATCH_SIZE = 10; // convertir 10 por ciclo para no saturar CPU

function convertirPDF(pdfPath, outputDir) {
  const prefix = path.join(outputDir, 'pagina');
  execSync(`pdftoppm -jpeg -r 150 "${pdfPath}" "${prefix}"`, { timeout: 120000 });
  const archivos = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('pagina') && f.endsWith('.jpg'))
    .sort();
  const renombrados = [];
  archivos.forEach((archivo, i) => {
    const nuevoNombre = `pagina_${i + 1}.jpg`;
    fs.renameSync(path.join(outputDir, archivo), path.join(outputDir, nuevoNombre));
    renombrados.push(nuevoNombre);
  });
  return renombrados;
}

function extractTitle(filename) {
  const noExt = filename.replace(/\.pdf$/i, '');
  const sinHash = noExt.replace(/^[0-9a-f]{16}_/i, '');
  const sinPdf = sinHash.replace(/_?pdf$/i, '');
  return sinPdf.replace(/_/g, ' ').trim() || noExt;
}

async function ciclo() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    const archivosFlat = fs.readdirSync(UPLOADS_DIR);

    // 1. Registrar PDFs del bot no registrados aún
    const pdfsBot = archivosFlat.filter(f => /^[0-9a-f]{16}_.*\.pdf$/i.test(f));
    let registrados = 0;
    for (const pdfFile of pdfsBot) {
      const hash16 = pdfFile.substring(0, 16);
      const patronId = `patron-${hash16.substring(0, 8)}`;
      const existe = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM patrones WHERE id = ?', [patronId], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });
      if (!existe) {
        const titulo = extractTitle(pdfFile);
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO patrones (id, titulo, descripcion, autor, diseñadora, categoria, dificultad, tiempo_minutos, paginas, thumbnail_path, activo, es_preview)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patronId, titulo, '', 'Telegram', '', 'amigurumi', 'principiante', 0, 1,
             `/uploads/patrones/${patronId}/pagina_1.jpg`, 1, 0],
            function(err) { if (err) reject(err); else { registrados++; resolve(); } }
          );
        });
      }
    }

    // 2. Convertir lote de patrones sin páginas
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id FROM patrones p LEFT JOIN paginas pg ON pg.patron_id = p.id WHERE pg.id IS NULL LIMIT ?`,
        [BATCH_SIZE],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    let convertidos = 0;
    for (const { id: patronId } of pendientes) {
      try {
        let pdfPath = null;
        const patronDir = path.join(UPLOADS_DIR, patronId);
        if (fs.existsSync(patronDir)) {
          const pdfEnSub = fs.readdirSync(patronDir).find(f => f.endsWith('.pdf'));
          if (pdfEnSub) pdfPath = path.join(patronDir, pdfEnSub);
        }
        if (!pdfPath) {
          const shortId = patronId.replace('patron-', '');
          const pdfFlat = archivosFlat.find(f => f.startsWith(shortId) && f.endsWith('.pdf'));
          if (pdfFlat) pdfPath = path.join(UPLOADS_DIR, pdfFlat);
        }
        if (!pdfPath) continue;

        fs.mkdirSync(patronDir, { recursive: true });
        const paginas = convertirPDF(pdfPath, patronDir);
        if (paginas.length === 0) continue;

        await new Promise((resolve, reject) => {
          db.run('UPDATE patrones SET paginas = ? WHERE id = ?', [paginas.length, patronId],
            function(err) { if (err) reject(err); else resolve(); }
          );
        });
        for (let i = 0; i < paginas.length; i++) {
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?, ?, ?, ?)',
              [uuidv4(), patronId, i + 1, `patrones/${patronId}/${paginas[i]}`],
              function(err) { if (err) reject(err); else resolve(); }
            );
          });
        }
        convertidos++;
        console.log(`[worker] ✅ ${patronId}: ${paginas.length} páginas`);
      } catch (err) {
        console.error(`[worker] ❌ ${patronId}:`, err.message);
      }
    }

    if (registrados > 0 || convertidos > 0) {
      console.log(`[worker] Ciclo: ${registrados} registrado(s), ${convertidos} convertido(s)`);
    }
  } catch (err) {
    console.error('[worker] Error en ciclo:', err.message);
  }
}

function iniciar() {
  console.log(`[worker] Sincronizador automático iniciado (cada ${INTERVALO_MS / 60000} min, lote ${BATCH_SIZE})`);
  ciclo(); // primer ciclo inmediato al arrancar
  setInterval(ciclo, INTERVALO_MS);
}

module.exports = { iniciar };
