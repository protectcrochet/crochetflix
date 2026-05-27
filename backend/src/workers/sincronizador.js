const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');
const INTERVALO_IDLE_MS = 5 * 60 * 1000;
const INTERVALO_ACTIVO_MS = 2 * 1000;   // 2s entre lotes cuando hay pendientes
const BATCH_SIZE = 60;                   // PDFs por ciclo
const CONCURRENCIA = 8;                  // conversiones en paralelo

function convertirPDF(pdfPath, outputDir) {
  const prefix = path.join(outputDir, 'pagina');
  return new Promise((resolve, reject) => {
    exec(`pdftoppm -jpeg -r 150 "${pdfPath}" "${prefix}" 2>/dev/null`, { timeout: 120000 }, (err) => {
      if (err) return reject(err);
      const archivos = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('pagina') && f.endsWith('.jpg'))
        .sort();
      const renombrados = [];
      archivos.forEach((archivo, i) => {
        const nuevoNombre = `pagina_${i + 1}.jpg`;
        fs.renameSync(path.join(outputDir, archivo), path.join(outputDir, nuevoNombre));
        renombrados.push(nuevoNombre);
      });
      resolve(renombrados);
    });
  });
}

function extractTitle(filename) {
  const noExt = filename.replace(/\.pdf$/i, '');
  const sinHash = noExt.replace(/^[0-9a-f]{16}_/i, '');
  const sinPdf = sinHash.replace(/_?pdf$/i, '');
  return sinPdf.replace(/_/g, ' ').trim() || noExt;
}

async function convertirPatron(patronId, archivosFlat) {
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
    if (!pdfPath) return false;

    fs.mkdirSync(patronDir, { recursive: true });
    const paginas = await convertirPDF(pdfPath, patronDir);
    if (paginas.length === 0) return false;

    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET paginas = ?, conversion_intentos = 0 WHERE id = ?', [paginas.length, patronId],
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
    console.log(`[worker] ✅ ${patronId}: ${paginas.length} págs.`);
    return true;
  } catch (err) {
    console.error(`[worker] ❌ ${patronId}:`, err.message);
    await new Promise((resolve) => {
      db.run(
        `UPDATE patrones SET conversion_intentos = conversion_intentos + 1,
         pdf_corrupto = CASE WHEN conversion_intentos + 1 >= 3 THEN 1 ELSE 0 END
         WHERE id = ?`,
        [patronId],
        () => resolve()
      );
    });
    return false;
  }
}

async function ciclo() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return 0;
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

    // 2. Obtener lote de pendientes
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id FROM patrones p LEFT JOIN paginas pg ON pg.patron_id = p.id
         WHERE pg.id IS NULL AND (p.pdf_corrupto IS NULL OR p.pdf_corrupto = 0) LIMIT ?`,
        [BATCH_SIZE],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    const corruptos = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as n FROM patrones WHERE pdf_corrupto = 1', [], (_, row) => resolve(row?.n || 0));
    });
    console.log(`[worker] Ciclo — PDFs bot: ${pdfsBot.length}, nuevos: ${registrados}, pendientes: ${pendientes.length}, corruptos: ${corruptos}`);

    // 3. Convertir en paralelo (CONCURRENCIA a la vez)
    let convertidos = 0;
    for (let i = 0; i < pendientes.length; i += CONCURRENCIA) {
      const chunk = pendientes.slice(i, i + CONCURRENCIA);
      const resultados = await Promise.all(
        chunk.map(({ id }) => convertirPatron(id, archivosFlat))
      );
      convertidos += resultados.filter(Boolean).length;
    }

    if (registrados > 0 || convertidos > 0) {
      console.log(`[worker] Ciclo: ${registrados} registrado(s), ${convertidos} convertido(s)`);
    }

    return convertidos;
  } catch (err) {
    console.error('[worker] Error en ciclo:', err.message);
    return 0;
  }
}

async function bucle() {
  const convertidos = await ciclo();
  const espera = convertidos > 0 ? INTERVALO_ACTIVO_MS : INTERVALO_IDLE_MS;
  setTimeout(bucle, espera);
}

function iniciar() {
  console.log(`[worker] Iniciado — lote ${BATCH_SIZE}, concurrencia ${CONCURRENCIA}`);
  bucle();
}

module.exports = { iniciar };
