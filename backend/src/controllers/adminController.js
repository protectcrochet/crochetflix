const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');

// Estado de jobs en segundo plano
let metadatosRunning = false;
let categoriasRunning = false;
let metadatosProgreso = { actualizados: 0, restantes: null };
let categoriasProgreso = { actualizados: 0, restantes: null };

// Convertir PDF a imágenes usando pdftoppm (poppler-utils)
function convertirPDF(pdfPath, outputDir) {
  const prefix = path.join(outputDir, 'pagina');
  execSync(`pdftoppm -jpeg -r 150 "${pdfPath}" "${prefix}"`, { timeout: 120000 });

  const archivos = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('pagina') && f.endsWith('.jpg'))
    .sort();

  // pdftoppm genera pagina-1.jpg, pagina-2.jpg, etc. — renombrar a pagina_1.jpg
  const renombrados = [];
  archivos.forEach((archivo, i) => {
    const numPagina = i + 1;
    const nuevoNombre = `pagina_${numPagina}.jpg`;
    fs.renameSync(path.join(outputDir, archivo), path.join(outputDir, nuevoNombre));
    renombrados.push(nuevoNombre);
  });

  return renombrados;
}

exports.crearPatron = async (req, res) => {
  const patronId = uuidv4();
  const patronDir = path.join(UPLOADS_DIR, patronId);
  fs.mkdirSync(patronDir, { recursive: true });

  try {
    const { titulo, descripcion, autor, diseñadora, categoria, subcategoria, dificultad, tiempo_minutos, es_preview } = req.body;

    if (!titulo || !autor || !categoria || !dificultad) {
      return res.status(400).json({ error: 'titulo, autor, categoria y dificultad son requeridos' });
    }

    const files = req.files || {};
    const pdf = files.pdf?.[0];
    const imagenes = files.imagenes || [];

    if (!pdf && imagenes.length === 0) {
      return res.status(400).json({ error: 'Debes subir un PDF o al menos una imagen' });
    }

    let paginas = [];

    if (pdf) {
      // Convertir PDF a imágenes
      const pdfPath = path.join(patronDir, 'original.pdf');
      fs.renameSync(pdf.path, pdfPath);
      paginas = convertirPDF(pdfPath, patronDir);
    } else {
      // Imágenes individuales: ordenar por nombre original y renombrar secuencialmente
      const sorted = imagenes.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));
      sorted.forEach((img, i) => {
        const nuevoNombre = `pagina_${i + 1}.jpg`;
        fs.renameSync(img.path, path.join(patronDir, nuevoNombre));
        paginas.push(nuevoNombre);
      });
    }

    if (paginas.length === 0) {
      return res.status(500).json({ error: 'No se generaron páginas del patrón' });
    }

    // Thumbnail = primera página (ruta pública servida por /uploads)
    const thumbnailPath = `/uploads/patrones/${patronId}/pagina_1.jpg`;

    // Insertar patrón en BD
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO patrones (id, titulo, descripcion, autor, diseñadora, categoria, subcategoria, dificultad, tiempo_minutos, paginas, thumbnail_path, es_preview)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [patronId, titulo, descripcion || '', autor, diseñadora || '', categoria, subcategoria || null, dificultad,
         parseInt(tiempo_minutos) || 0, paginas.length, thumbnailPath, es_preview === 'true' ? 1 : 0],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });

    // Insertar páginas en BD
    for (let i = 0; i < paginas.length; i++) {
      const paginaId = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?, ?, ?, ?)`,
          [paginaId, patronId, i + 1, `patrones/${patronId}/${paginas[i]}`],
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
    }

    res.status(201).json({
      message: 'Patrón creado correctamente',
      patron: { id: patronId, titulo, paginas: paginas.length }
    });

  } catch (err) {
    // Limpiar directorio si algo falló
    fs.rmSync(patronDir, { recursive: true, force: true });
    console.error('Error crear patron:', err);
    res.status(500).json({ error: 'Error procesando el patrón: ' + err.message });
  }
};

exports.exportarCSV = async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, titulo, diseñadora, autor, categoria, subcategoria, dificultad, descripcion, activo FROM patrones ORDER BY created_at DESC',
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cabecera = ['id', 'titulo', 'diseñadora', 'autor', 'categoria', 'subcategoria', 'dificultad', 'descripcion', 'activo'];
    const filas = patrones.map(p =>
      [p.id, p.titulo, p.diseñadora, p.autor, p.categoria, p.subcategoria, p.dificultad, p.descripcion, p.activo ? 'si' : 'no']
        .map(escapar).join(',')
    );

    const csv = [cabecera.join(','), ...filas].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="patrones.csv"');
    res.send('﻿' + csv); // BOM para que Excel abra UTF-8 correctamente
  } catch (err) {
    res.status(500).json({ error: 'Error exportando' });
  }
};

exports.importarCSV = async (req, res) => {
  try {
    const archivo = req.file;
    if (!archivo) return res.status(400).json({ error: 'No se recibió archivo CSV' });

    const contenido = fs.readFileSync(archivo.path, 'utf-8').replace(/^﻿/, '');
    const lineas = contenido.trim().split('\n');
    const cabecera = lineas[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    const idx = (campo) => cabecera.indexOf(campo);
    if (idx('id') === -1) return res.status(400).json({ error: 'El CSV debe tener columna "id"' });

    const parsearCelda = (celda) => celda?.trim().replace(/^"|"$/g, '').replace(/""/g, '"') ?? '';

    let actualizados = 0;
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].match(/("(?:[^"]|"")*"|[^,]*)/g) || [];
      const get = (campo) => parsearCelda(cols[idx(campo)]);

      const id = get('id');
      if (!id) continue;

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE patrones SET
            titulo      = COALESCE(NULLIF(?, ''), titulo),
            diseñadora  = COALESCE(NULLIF(?, ''), diseñadora),
            autor       = COALESCE(NULLIF(?, ''), autor),
            categoria   = COALESCE(NULLIF(?, ''), categoria),
            subcategoria= COALESCE(NULLIF(?, ''), subcategoria),
            dificultad  = COALESCE(NULLIF(?, ''), dificultad),
            descripcion = COALESCE(NULLIF(?, ''), descripcion),
            activo      = CASE WHEN ? = 'no' THEN 0 WHEN ? = 'si' THEN 1 ELSE activo END
           WHERE id = ?`,
          [get('titulo'), get('diseñadora'), get('autor'), get('categoria'),
           get('subcategoria'), get('dificultad'), get('descripcion'),
           get('activo'), get('activo'), id],
          function(err) { if (err) reject(err); else { actualizados += this.changes; resolve(); } }
        );
      });
    }

    fs.unlinkSync(archivo.path);
    res.json({ message: `${actualizados} patrones actualizados` });
  } catch (err) {
    console.error('Error importar CSV:', err);
    res.status(500).json({ error: 'Error procesando CSV: ' + err.message });
  }
};

exports.listarPatrones = async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, titulo, autor, diseñadora, categoria, subcategoria, dificultad, paginas, es_preview, activo, destacado, tendencia, verificado, pdf_corrupto, conversion_intentos, thumbnail_path, hero_position, created_at FROM patrones ORDER BY created_at DESC',
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    res.json({ patrones });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

// Extrae título legible del nombre de archivo del bot (hash16_Nombre_Del_Patron.pdf)
function extractTitleFromFilename(filename) {
  const noExt = filename.replace(/\.pdf$/i, '');
  const withoutHash = noExt.replace(/^[0-9a-f]{16}_/i, '');
  const withoutPdfSuffix = withoutHash.replace(/_?pdf$/i, '');
  return withoutPdfSuffix.replace(/_/g, ' ').trim() || noExt;
}

const BATCH_SIZE = 20; // PDFs a convertir por llamada (evita timeout HTTP)

exports.sincronizarPDFs = async (req, res) => {
  try {
    const archivosFlat = fs.readdirSync(UPLOADS_DIR);
    let registrados = 0;

    // Fase 1: Auto-registrar PDFs del bot que no tienen entrada en patrones
    // Formato del bot: [hash16]_[Nombre].pdf
    const pdfsBotFormat = archivosFlat.filter(f => /^[0-9a-f]{16}_.*\.pdf$/i.test(f));

    for (const pdfFile of pdfsBotFormat) {
      const hash16 = pdfFile.substring(0, 16);
      const patronId = `patron-${hash16.substring(0, 8)}`;

      const existe = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM patrones WHERE id = ?', [patronId], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (!existe) {
        const titulo = extractTitleFromFilename(pdfFile);
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO patrones (id, titulo, descripcion, autor, diseñadora, categoria, dificultad, tiempo_minutos, paginas, thumbnail_path, activo, es_preview)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patronId, titulo, '', 'Telegram', '', 'amigurumi', 'principiante', 0, 1,
             `/uploads/patrones/${patronId}/pagina_1.jpg`, 1, 0],
            function(err) { if (err) reject(err); else { registrados++; resolve(); } }
          );
        });
        console.log(`[sincronizar] 📝 Registrado: ${patronId} — ${titulo}`);
      }
    }

    // Fase 2: Convertir lote de patrones sin páginas (max BATCH_SIZE para evitar timeout)
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id FROM patrones p
         LEFT JOIN paginas pg ON pg.patron_id = p.id
         WHERE pg.id IS NULL
         LIMIT ?`,
        [BATCH_SIZE],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    let procesados = 0;
    const errores = [];

    for (const { id: patronId } of pendientes) {
      try {
        let pdfPath = null;
        const patronDir = path.join(UPLOADS_DIR, patronId);

        if (fs.existsSync(patronDir)) {
          const subFiles = fs.readdirSync(patronDir);
          const pdfEnSub = subFiles.find(f => f.endsWith('.pdf'));
          if (pdfEnSub) pdfPath = path.join(patronDir, pdfEnSub);
        }

        if (!pdfPath) {
          const shortId = patronId.replace('patron-', '');
          const pdfFlat = archivosFlat.find(f => f.startsWith(shortId) && f.endsWith('.pdf'));
          if (pdfFlat) pdfPath = path.join(UPLOADS_DIR, pdfFlat);
        }

        if (!pdfPath) {
          errores.push(`${patronId}: PDF no encontrado`);
          continue;
        }

        fs.mkdirSync(patronDir, { recursive: true });
        const paginas = convertirPDF(pdfPath, patronDir);

        if (paginas.length === 0) {
          errores.push(`${patronId}: no se generaron páginas`);
          continue;
        }

        await new Promise((resolve, reject) => {
          db.run('UPDATE patrones SET paginas = ? WHERE id = ?', [paginas.length, patronId],
            function(err) { if (err) reject(err); else resolve(); }
          );
        });

        for (let i = 0; i < paginas.length; i++) {
          const paginaId = uuidv4();
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?, ?, ?, ?)',
              [paginaId, patronId, i + 1, `patrones/${patronId}/${paginas[i]}`],
              function(err) { if (err) reject(err); else resolve(); }
            );
          });
        }

        procesados++;
        console.log(`[sincronizar] ✅ ${patronId}: ${paginas.length} páginas`);
      } catch (err) {
        console.error(`[sincronizar] ❌ ${patronId}:`, err.message);
        errores.push(`${patronId}: ${err.message}`);
      }
    }

    // Cuántos quedan pendientes de conversión
    const pendientesRestantes = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM patrones p LEFT JOIN paginas pg ON pg.patron_id = p.id WHERE pg.id IS NULL`,
        [],
        (err, row) => { if (err) reject(err); else resolve(row.total); }
      );
    });

    const partes = [];
    if (registrados > 0) partes.push(`${registrados} registrado(s)`);
    if (procesados > 0) partes.push(`${procesados} convertido(s)`);
    if (registrados === 0 && procesados === 0) partes.push('Sin cambios');

    res.json({
      message: partes.join(', ') + (pendientesRestantes > 0 ? ` — quedan ${pendientesRestantes} por convertir` : ' — todo al día'),
      registrados,
      procesados,
      pendientes: pendientesRestantes,
      errores: errores.length ? errores : undefined
    });
  } catch (err) {
    console.error('Error sincronizar:', err);
    res.status(500).json({ error: 'Error sincronizando: ' + err.message });
  }
};

exports.categorizarConIA = async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en .env' });
  }

  try {
    // Obtener patrones sin categorizar (los del bot tienen dificultad='principiante' y diseñadora vacía)
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo FROM patrones WHERE autor = 'Telegram' AND (diseñadora = '' OR diseñadora IS NULL) LIMIT 50`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    if (pendientes.length === 0) {
      return res.json({ message: 'Todos los patrones ya están categorizados', actualizados: 0 });
    }

    const anthropic = new Anthropic({ apiKey });
    const LOTE = 20;
    let actualizados = 0;

    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Clasifica estos patrones de crochet. Responde SOLO con un JSON array válido, sin texto adicional.

Formato de cada elemento:
{
  "id": "el id exacto",
  "titulo_limpio": "título legible sin 'pdf', sin números raros, sin guiones bajos",
  "diseñadora": "nombre del diseñador si aparece claramente en el título, sino null",
  "categoria": "amigurumi|ropa|accesorios|decoracion|hogar|navidad|halloween|otro",
  "subcategoria": "animales|personas y muñecos|comida|plantas y flores|personajes y fantasía|navidad|otro (solo si amigurumi, sino null)",
  "dificultad": "principiante|intermedio|avanzado"
}

Reglas:
- amigurumi: muñecos tejidos, animales, personajes, figuras 3D
- ropa: suéteres, vestidos, blusas, pantalones
- accesorios: bolsos, mochilas, gorros, bufandas, joyería tejida
- decoracion: flores, guirnaldas, móviles, adornos decorativos
- hogar: cojines, tapetes, manteles, fundas
- navidad: santa, renos, árboles, elfo, regalos navideños
- halloween: calabazas, fantasmas, brujas, murciélagos
- dificultad: si el título no da pistas → principiante

Patrones:
${JSON.stringify(lote.map(p => ({ id: p.id, titulo: p.titulo })), null, 2)}`
        }]
      });

      let resultados;
      try {
        const texto = msg.content[0].text.trim();
        const jsonStr = texto.startsWith('[') ? texto : texto.match(/\[[\s\S]*\]/)?.[0];
        resultados = JSON.parse(jsonStr);
      } catch (e) {
        console.error('[categorizar] Error parseando respuesta de Claude:', e.message);
        continue;
      }

      for (const r of resultados) {
        if (!r.id) continue;
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE patrones SET
              titulo = COALESCE(NULLIF(?, ''), titulo),
              diseñadora = ?,
              categoria = COALESCE(NULLIF(?, ''), categoria),
              subcategoria = ?,
              dificultad = COALESCE(NULLIF(?, ''), dificultad)
            WHERE id = ?`,
            [r.titulo_limpio, r.diseñadora || 'N/A', r.categoria, r.subcategoria || null, r.dificultad, r.id],
            function(err) { if (err) reject(err); else { actualizados += this.changes; resolve(); } }
          );
        });
      }

      console.log(`[categorizar] Lote ${Math.floor(i/LOTE)+1}: ${resultados.length} patrones procesados`);
    }

    // Cuántos quedan
    const restantes = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM patrones WHERE autor = 'Telegram' AND (diseñadora = '' OR diseñadora IS NULL)`,
        [],
        (err, row) => { if (err) reject(err); else resolve(row.total); }
      );
    });

    res.json({
      message: `${actualizados} patrón(es) categorizados${restantes > 0 ? ` — quedan ${restantes} por procesar` : ' — ¡todos al día!'}`,
      actualizados,
      restantes
    });
  } catch (err) {
    console.error('Error categorizar:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
};

// ── Job en segundo plano: extracción de metadatos ──────────────────────────
async function _runExtraccionMetadatos(apiKey) {
  const anthropic = new Anthropic({ apiKey });
  const LOTE = 10;
  let totalActualizados = 0;

  while (true) {
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo FROM patrones
         WHERE autor = 'Telegram' AND (diseñadora IS NULL OR diseñadora = '' OR diseñadora = 'N/A')
         LIMIT 30`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    if (pendientes.length === 0) break;

    const archivosFlat = fs.readdirSync(UPLOADS_DIR);

    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);
      const datos = lote.map(p => {
        const pdfPath = localizarPDF(p.id, archivosFlat);
        const texto = pdfPath ? extraerTextoPDF(pdfPath) : '';
        return { id: p.id, titulo: p.titulo, texto };
      });

      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: `Analiza estos patrones de crochet. Extrae el nombre real del patrón y el nombre de la diseñadora/diseñador leyendo el contenido del PDF.

Responde SOLO con un JSON array válido, sin texto adicional:
[{"id": "...", "titulo_limpio": "Nombre real del patrón", "diseñadora": "Nombre o null", "idioma": "es|en|pt|fr|de|it|otro"}]

Reglas para título:
- Usa el nombre oficial del patrón tal como aparece en el PDF (primera página)
- Si no hay título claro en el texto, mejora el título actual quitando guiones bajos, hashes y sufijos "_pdf"
- Máximo 80 caracteres

Reglas para diseñadora:
- Si aparece claramente un nombre de persona, marca, tienda, blog o usuario → ponlo
- Si no hay ninguna pista → null
- No pongas "Desconocida", "Unknown" ni descripciones

Reglas para idioma:
- Detecta el idioma principal del texto del PDF
- Usa: es (español), en (inglés), pt (portugués), fr (francés), de (alemán), it (italiano), otro
- Si el PDF está vacío o no hay texto claro → es (por defecto)

Patrones:
${JSON.stringify(datos.map(d => ({ id: d.id, titulo_actual: d.titulo, texto_pdf: d.texto.slice(0, 900) })), null, 2)}` }]
        });
        const texto = msg.content[0].text.trim();
        const jsonStr = texto.startsWith('[') ? texto : texto.match(/\[[\s\S]*\]/)?.[0];
        const resultados = JSON.parse(jsonStr);
        for (const r of resultados) {
          if (!r.id) continue;
          const diseñadora = r.diseñadora && r.diseñadora !== 'null' ? r.diseñadora : 'N/A';
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE patrones SET diseñadora = ?, titulo = COALESCE(NULLIF(?, ''), titulo), idioma = ? WHERE id = ?`,
              [diseñadora, r.titulo_limpio?.trim() || null, r.idioma || 'es', r.id],
              function(err) { if (err) reject(err); else { totalActualizados += this.changes; resolve(); } }
            );
          });
        }
      } catch (e) {
        console.error('[meta] Error en lote:', e.message);
        if (e.status === 400 || e.status === 429 || (e.message && e.message.includes('credit'))) {
          console.log('[meta] Créditos agotados — deteniendo extracción.');
          return;
        }
      }
    }

    const restantes = await new Promise(r => {
      db.get(`SELECT COUNT(*) as n FROM patrones WHERE autor='Telegram' AND (diseñadora IS NULL OR diseñadora='' OR diseñadora='N/A')`,
        [], (_, row) => r(row?.n || 0));
    });
    metadatosProgreso = { actualizados: totalActualizados, restantes };
    console.log(`[meta] Ciclo completado — actualizados: ${totalActualizados}, restantes: ${restantes}`);
  }

  console.log(`[meta] Finalizado — ${totalActualizados} patrones actualizados`);
  metadatosProgreso = { actualizados: totalActualizados, restantes: 0 };
}

exports.extraerMetadatosFondo = async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en .env' });
  if (metadatosRunning) return res.json({ message: 'Ya está corriendo en el servidor', running: true, progreso: metadatosProgreso });

  metadatosRunning = true;
  metadatosProgreso = { actualizados: 0, restantes: null };
  res.json({ message: 'Extracción iniciada en el servidor. Puedes cerrar la laptop.', running: true });

  _runExtraccionMetadatos(apiKey)
    .catch(err => console.error('[meta] Error fatal:', err.message))
    .finally(() => { metadatosRunning = false; });
};

// ── Job en segundo plano: categorización con IA ─────────────────────────────
async function _runCategorizacion(apiKey) {
  const anthropic = new Anthropic({ apiKey });
  const LOTE = 20;
  let totalActualizados = 0;

  while (true) {
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo FROM patrones WHERE autor = 'Telegram' AND (diseñadora = '' OR diseñadora IS NULL) LIMIT 50`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    if (pendientes.length === 0) break;

    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: `Clasifica estos patrones de crochet. Responde SOLO con un JSON array válido, sin texto adicional.

Formato de cada elemento:
{"id":"...","titulo_limpio":"...","diseñadora":"...o null","categoria":"amigurumi|ropa|accesorios|decoracion|hogar|navidad|halloween|otro","subcategoria":"animales|personas y muñecos|comida|plantas y flores|personajes y fantasía|navidad|otro (solo si amigurumi, sino null)","dificultad":"principiante|intermedio|avanzado"}

Reglas: amigurumi=muñecos 3D, ropa=prendas, accesorios=bolsos/gorros, decoracion=adornos, hogar=tapetes/cojines, navidad/halloween=temáticos. Sin pistas de dificultad→principiante.

Patrones:
${JSON.stringify(lote.map(p => ({ id: p.id, titulo: p.titulo })), null, 2)}` }]
        });
        const texto = msg.content[0].text.trim();
        const jsonStr = texto.startsWith('[') ? texto : texto.match(/\[[\s\S]*\]/)?.[0];
        const resultados = JSON.parse(jsonStr);
        for (const r of resultados) {
          if (!r.id) continue;
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE patrones SET titulo=COALESCE(NULLIF(?,''),titulo), diseñadora=?, categoria=COALESCE(NULLIF(?,''),categoria), subcategoria=?, dificultad=COALESCE(NULLIF(?,''),dificultad) WHERE id=?`,
              [r.titulo_limpio, r.diseñadora||'N/A', r.categoria, r.subcategoria||null, r.dificultad, r.id],
              function(err) { if (err) reject(err); else { totalActualizados += this.changes; resolve(); } }
            );
          });
        }
      } catch (e) {
        console.error('[cat] Error en lote:', e.message);
        if (e.status === 400 || e.status === 429 || (e.message && e.message.includes('credit'))) {
          console.log('[cat] Créditos agotados — deteniendo categorización.');
          return;
        }
      }
    }

    const restantes = await new Promise(r => {
      db.get(`SELECT COUNT(*) as n FROM patrones WHERE autor='Telegram' AND (diseñadora='' OR diseñadora IS NULL)`,
        [], (_, row) => r(row?.n || 0));
    });
    categoriasProgreso = { actualizados: totalActualizados, restantes };
    console.log(`[cat] Ciclo completado — actualizados: ${totalActualizados}, restantes: ${restantes}`);
  }

  console.log(`[cat] Finalizado — ${totalActualizados} patrones categorizados`);
  categoriasProgreso = { actualizados: totalActualizados, restantes: 0 };
}

exports.categorizarFondo = async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en .env' });
  if (categoriasRunning) return res.json({ message: 'Ya está corriendo en el servidor', running: true, progreso: categoriasProgreso });

  categoriasRunning = true;
  categoriasProgreso = { actualizados: 0, restantes: null };
  res.json({ message: 'Categorización iniciada en el servidor. Puedes cerrar la laptop.', running: true });

  _runCategorizacion(apiKey)
    .catch(err => console.error('[cat] Error fatal:', err.message))
    .finally(() => { categoriasRunning = false; });
};

exports.normalizarCategorias = async (req, res) => {
  try {
    const changes = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE patrones SET categoria = LOWER(TRIM(categoria)) WHERE categoria != LOWER(TRIM(categoria))`,
        [],
        function(err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
    res.json({ message: `${changes} categorías normalizadas` });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

// Extrae texto de las primeras 2 páginas de un PDF
function extraerTextoPDF(pdfPath) {
  try {
    const texto = execSync(`pdftotext -f 1 -l 2 "${pdfPath}" -`, { timeout: 15000 }).toString();
    return texto.slice(0, 1500).trim();
  } catch {
    return '';
  }
}

// Localiza el PDF de un patrón en el filesystem
function localizarPDF(patronId, archivosFlat) {
  const patronDir = path.join(UPLOADS_DIR, patronId);
  if (fs.existsSync(patronDir)) {
    const pdf = fs.readdirSync(patronDir).find(f => f.endsWith('.pdf'));
    if (pdf) return path.join(patronDir, pdf);
  }
  const shortId = patronId.replace('patron-', '');
  const flat = archivosFlat.find(f => f.startsWith(shortId) && f.endsWith('.pdf'));
  return flat ? path.join(UPLOADS_DIR, flat) : null;
}

exports.extraerDiseñadoras = async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en .env' });

  try {
    // Patrones sin diseñadora real (N/A, vacío, o null)
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo FROM patrones
         WHERE autor = 'Telegram' AND (diseñadora IS NULL OR diseñadora = '' OR diseñadora = 'N/A')
         LIMIT 30`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    if (pendientes.length === 0) {
      return res.json({ message: 'Todos tienen diseñadora', actualizados: 0, restantes: 0 });
    }

    const archivosFlat = fs.readdirSync(UPLOADS_DIR);
    const anthropic = new Anthropic({ apiKey });
    const LOTE = 10;
    let actualizados = 0;

    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);

      // Extraer texto PDF de cada patrón del lote
      const datos = lote.map(p => {
        const pdfPath = localizarPDF(p.id, archivosFlat);
        const texto = pdfPath ? extraerTextoPDF(pdfPath) : '';
        return { id: p.id, titulo: p.titulo, texto };
      });

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Analiza estos patrones de crochet. Extrae el nombre real del patrón y el nombre de la diseñadora/diseñador leyendo el contenido del PDF.

Responde SOLO con un JSON array válido, sin texto adicional:
[{"id": "...", "titulo_limpio": "Nombre real del patrón", "diseñadora": "Nombre o null", "idioma": "es|en|pt|fr|de|it|otro"}]

Reglas para título:
- Usa el nombre oficial del patrón tal como aparece en el PDF (primera página)
- Si no hay título claro en el texto, mejora el título actual quitando guiones bajos, hashes y sufijos "_pdf"
- Máximo 80 caracteres

Reglas para diseñadora:
- Si aparece claramente un nombre de persona, marca, tienda, blog o usuario → ponlo
- Si no hay ninguna pista → null
- No pongas "Desconocida", "Unknown" ni descripciones

Reglas para idioma:
- Detecta el idioma principal del texto del PDF
- Usa: es (español), en (inglés), pt (portugués), fr (francés), de (alemán), it (italiano), otro
- Si el PDF está vacío o no hay texto claro → es (por defecto)

Patrones:
${JSON.stringify(datos.map(d => ({ id: d.id, titulo_actual: d.titulo, texto_pdf: d.texto.slice(0, 900) })), null, 2)}`
        }]
      });

      let resultados;
      try {
        const texto = msg.content[0].text.trim();
        const jsonStr = texto.startsWith('[') ? texto : texto.match(/\[[\s\S]*\]/)?.[0];
        resultados = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      for (const r of resultados) {
        if (!r.id) continue;
        const diseñadora = r.diseñadora && r.diseñadora !== 'null' ? r.diseñadora : 'N/A';
        const titulo = r.titulo_limpio?.trim() || null;
        const idioma = r.idioma || 'es';
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE patrones SET diseñadora = ?, titulo = COALESCE(NULLIF(?, ''), titulo), idioma = ? WHERE id = ?`,
            [diseñadora, titulo, idioma, r.id],
            function(err) { if (err) reject(err); else { actualizados += this.changes; resolve(); } }
          );
        });
      }
    }

    const restantes = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM patrones WHERE autor = 'Telegram' AND (diseñadora IS NULL OR diseñadora = '' OR diseñadora = 'N/A')`,
        [],
        (err, row) => { if (err) reject(err); else resolve(row.total); }
      );
    });

    res.json({ message: `${actualizados} diseñadoras extraídas`, actualizados, restantes });
  } catch (err) {
    console.error('Error extraer diseñadoras:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
};

exports.stats = async (req, res) => {
  try {
    const [totalRow, convertidosRow, verificadosRow, heroRow, tendenciaRow, pendientesRow, corruptosRow] = await Promise.all([
      new Promise((r, j) => db.get('SELECT COUNT(*) as n FROM patrones WHERE activo = 1', [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get('SELECT COUNT(DISTINCT patron_id) as n FROM paginas', [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get('SELECT COUNT(*) as n FROM patrones WHERE verificado = 1', [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get('SELECT COUNT(*) as n FROM patrones WHERE destacado = 1', [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get('SELECT COUNT(*) as n FROM patrones WHERE tendencia = 1', [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get(
        `SELECT COUNT(*) as n FROM patrones p LEFT JOIN paginas pg ON pg.patron_id = p.id
         WHERE p.activo = 1 AND pg.id IS NULL AND (p.pdf_corrupto IS NULL OR p.pdf_corrupto = 0)`,
        [], (e, row) => e ? j(e) : r(row))),
      new Promise((r, j) => db.get(
        `SELECT COUNT(*) as n FROM patrones p LEFT JOIN paginas pg ON pg.patron_id = p.id
         WHERE p.activo = 1 AND pg.id IS NULL AND p.pdf_corrupto = 1`,
        [], (e, row) => e ? j(e) : r(row))),
    ]);

    const total = totalRow.n;
    const convertidos = convertidosRow.n;
    const pendientes = pendientesRow.n;
    const corruptos = corruptosRow.n;

    // Contar PDFs del bot en disco
    let archivosBot = 0;
    try {
      archivosBot = fs.readdirSync(UPLOADS_DIR).filter(f => /^[0-9a-f]{16}_.*\.pdf$/i.test(f)).length;
    } catch {}

    // Desglose por categoría
    const porCategoria = await new Promise((r, j) => {
      db.all('SELECT categoria, COUNT(*) as n FROM patrones WHERE activo = 1 GROUP BY categoria ORDER BY n DESC', [], (e, rows) => e ? j(e) : r(rows));
    });

    res.json({
      total, convertidos, pendientes, corruptos, archivosBot,
      verificados: verificadosRow.n,
      heroes: heroRow.n,
      tendencia: tendenciaRow.n,
      porCategoria,
      metadatosRunning,
      categoriasRunning,
      metadatosProgreso,
      categoriasProgreso,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.editarPatron = async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, diseñadora, categoria, subcategoria, dificultad, descripcion } = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE patrones SET
          titulo     = COALESCE(NULLIF(?, ''), titulo),
          diseñadora = ?,
          categoria  = COALESCE(NULLIF(?, ''), categoria),
          subcategoria = ?,
          dificultad = COALESCE(NULLIF(?, ''), dificultad),
          descripcion = COALESCE(NULLIF(?, ''), descripcion)
         WHERE id = ?`,
        [titulo, diseñadora ?? '', categoria, subcategoria ?? null, dificultad, descripcion ?? '', id],
        function(err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.toggleVerificado = async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT verificado FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });
    const nuevoEstado = patron.verificado ? 0 : 1;
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET verificado = ? WHERE id = ?', [nuevoEstado, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ verificado: nuevoEstado === 1 });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.toggleTendencia = async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT tendencia FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });
    const nuevoEstado = patron.tendencia ? 0 : 1;
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET tendencia = ? WHERE id = ?', [nuevoEstado, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ tendencia: nuevoEstado === 1 });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.toggleDestacado = async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT destacado FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });
    const nuevoEstado = patron.destacado ? 0 : 1;
    if (nuevoEstado === 1) {
      const { total } = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as total FROM patrones WHERE destacado = 1', [], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });
      if (total >= 12) return res.status(400).json({ error: 'Máximo 12 patrones en el hero' });
    }
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET destacado = ? WHERE id = ?', [nuevoEstado, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ destacado: nuevoEstado === 1 });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.toggleCorrupto = async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT pdf_corrupto FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });
    const nuevoEstado = patron.pdf_corrupto ? 0 : 1;
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE patrones SET pdf_corrupto = ?, conversion_intentos = 0 WHERE id = ?',
        [nuevoEstado, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ pdf_corrupto: nuevoEstado });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.guardarHeroPosition = (req, res) => {
  const { id } = req.params;
  const { hero_position } = req.body;
  if (!hero_position) return res.status(400).json({ error: 'Falta hero_position' });
  db.run('UPDATE patrones SET hero_position = ? WHERE id = ?', [hero_position, id], function(err) {
    if (err) return res.status(500).json({ error: 'Error guardando posición' });
    res.json({ ok: true });
  });
};

exports.toggleActivo = async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT activo FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });

    const nuevoEstado = patron.activo ? 0 : 1;
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET activo = ? WHERE id = ?', [nuevoEstado, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });

    res.json({ activo: nuevoEstado === 1 });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.eliminarPatron = async (req, res) => {
  try {
    const { id } = req.params;
    const patronDir = path.join(UPLOADS_DIR, id);

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM paginas WHERE patron_id = ?', [id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM patrones WHERE id = ?', [id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });

    if (fs.existsSync(patronDir)) {
      fs.rmSync(patronDir, { recursive: true, force: true });
    }

    res.json({ message: 'Patrón eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.repararThumbnails = async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all('SELECT id, thumbnail_path FROM patrones WHERE activo = 1', [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    let reparados = 0, rotos = 0, sinImagen = 0;

    for (const p of patrones) {
      const patronDir = path.join(UPLOADS_DIR, p.id);

      // Si no tiene thumbnail_path asignado
      if (!p.thumbnail_path) {
        sinImagen++;
        // Intentar asignar la primera imagen disponible
        if (fs.existsSync(patronDir)) {
          const imgs = fs.readdirSync(patronDir).filter(f => f.endsWith('.jpg')).sort();
          if (imgs.length > 0) {
            const nuevaRuta = `/uploads/patrones/${p.id}/${imgs[0]}`;
            await new Promise(r => db.run('UPDATE patrones SET thumbnail_path = ? WHERE id = ?', [nuevaRuta, p.id], r));
            reparados++;
            sinImagen--;
          }
        }
        continue;
      }

      // Verificar que el archivo existe
      const rutaAbsoluta = path.join(__dirname, '../../', p.thumbnail_path.replace(/^\//, ''));
      if (!fs.existsSync(rutaAbsoluta)) {
        rotos++;
        // Buscar cualquier jpg en el directorio del patrón
        if (fs.existsSync(patronDir)) {
          const imgs = fs.readdirSync(patronDir).filter(f => f.endsWith('.jpg')).sort();
          if (imgs.length > 0) {
            const nuevaRuta = `/uploads/patrones/${p.id}/${imgs[0]}`;
            await new Promise(r => db.run('UPDATE patrones SET thumbnail_path = ? WHERE id = ?', [nuevaRuta, p.id], r));
            reparados++;
            rotos--;
          }
        }
      }
    }

    res.json({
      message: `${reparados} thumbnails reparados · ${rotos} siguen rotos (sin imágenes) · ${sinImagen} sin imagen`,
      reparados, rotos, sinImagen,
    });
  } catch (err) {
    console.error('Error reparando thumbnails:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.fixAutorTelegram = async (req, res) => {
  try {
    const r1 = await new Promise((resolve, reject) => {
      db.run(`UPDATE patrones SET autor = 'Diseñadora' WHERE autor = 'Telegram'`, [],
        function(err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
    const r2 = await new Promise((resolve, reject) => {
      db.run(`UPDATE patrones SET diseñadora = 'Diseñadora' WHERE diseñadora = 'N/A' OR diseñadora = ''`, [],
        function(err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
    res.json({ message: `Listo: ${r1} autor(es) y ${r2} diseñadora(s) actualizadas` });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};
