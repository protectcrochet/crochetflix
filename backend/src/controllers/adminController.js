const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');

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
        'SELECT id, titulo, autor, diseñadora, categoria, subcategoria, dificultad, paginas, es_preview, activo, created_at FROM patrones ORDER BY created_at DESC',
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
