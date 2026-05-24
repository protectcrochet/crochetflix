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

    // Thumbnail = primera página
    const thumbnailPath = `patrones/${patronId}/pagina_1.jpg`;

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
