const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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

exports.sincronizarPDFs = async (req, res) => {
  try {
    // Patrones sin entradas en paginas
    const pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id FROM patrones p
         LEFT JOIN paginas pg ON pg.patron_id = p.id
         WHERE pg.id IS NULL`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    if (pendientes.length === 0) {
      return res.json({ message: 'No hay patrones pendientes de sincronizar', procesados: 0 });
    }

    const archivosFlat = fs.readdirSync(UPLOADS_DIR);
    let procesados = 0;
    const errores = [];

    for (const { id: patronId } of pendientes) {
      try {
        // Buscar el PDF: puede estar en subdir propio o en directorio plano (bot Telegram)
        let pdfPath = null;
        const patronDir = path.join(UPLOADS_DIR, patronId);

        // Primero buscar en subdirectorio del patrón
        if (fs.existsSync(patronDir)) {
          const subFiles = fs.readdirSync(patronDir);
          const pdfEnSub = subFiles.find(f => f.endsWith('.pdf'));
          if (pdfEnSub) pdfPath = path.join(patronDir, pdfEnSub);
        }

        // Si no, buscar en directorio plano (bot Telegram usa shortId como prefijo)
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

    res.json({
      message: `${procesados} patrón(es) sincronizado(s)`,
      procesados,
      errores: errores.length ? errores : undefined
    });
  } catch (err) {
    console.error('Error sincronizar:', err);
    res.status(500).json({ error: 'Error sincronizando: ' + err.message });
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
