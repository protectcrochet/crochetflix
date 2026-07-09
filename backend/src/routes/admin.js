const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function verifyAdmin(req, res, next) {
  const authHeader = req.headers['x-admin-secret'] || req.body.adminSecret;
  
  if (!ADMIN_SECRET) {
    return res.status(500).json({ error: 'ADMIN_SECRET no configurado' });
  }
  
  if (authHeader !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/patrones');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ── Helpers de visión ─────────────────────────────────────────────────────────

async function pageToBase64(convert, pageNum, tempFiles) {
  try {
    const result = await convert(pageNum);
    if (result?.path && fs.existsSync(result.path)) {
      const b64 = fs.readFileSync(result.path).toString('base64');
      tempFiles.push(result.path);
      return b64;
    }
  } catch {}
  return null;
}

async function extraerConVision(groqApiKey, base64Images) {
  if (!base64Images.length) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Estas son páginas de un patrón de crochet. Extrae: 1) Título exacto 2) Nombre del/la diseñador/a. Si no encuentras alguno pon null. Responde SOLO con JSON: {"titulo": "...", "diseñadora": "..."}' },
            ...base64Images.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
          ],
        }],
        temperature: 0.1,
        max_tokens: 150,
      },
      { headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' }, timeout: 25000 }
    );
    const text = res.data.choices[0].message.content.trim();
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return (parsed.titulo || parsed.diseñadora) ? parsed : null;
  } catch (err) {
    console.error('Error visión Groq:', err?.response?.data || err.message);
    return null;
  }
}

// ── Endpoint: analizar patrón antes de subir ────────────────────────────────

router.post('/patrones/analizar', verifyAdmin, upload.single('pdf'), async (req, res) => {
  const tempFiles = [];
  try {
    let { titulo, descripcion, diseñadora } = req.body;
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) return res.status(500).json({ error: 'GROQ_API_KEY no configurada' });

    // Si se subió PDF y falta título/diseñadora, extraer con visión de páginas
    if (req.file) {
      tempFiles.push(req.file.path);

      if (!titulo?.trim() || !diseñadora?.trim()) {
        const { fromPath } = require('pdf2pic');
        const tempDir = path.join(__dirname, '../../uploads/temp-analisis');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const opts = { density: 100, saveFilename: `an_${Date.now()}`, savePath: tempDir, format: 'jpeg', width: 800, height: 1100 };
        const convert = fromPath(req.file.path, opts);

        // Páginas 1-3
        const imgs1_3 = [];
        for (let p = 1; p <= 3; p++) {
          const b64 = await pageToBase64(convert, p, tempFiles);
          if (b64) imgs1_3.push(b64); else break;
        }

        let extraido = imgs1_3.length ? await extraerConVision(groqApiKey, imgs1_3) : null;

        // Si no encontró, buscar en últimas 2 páginas
        if (!extraido?.titulo && !extraido?.diseñadora) {
          const allImgs = [...imgs1_3];
          for (let p = 4; p <= 80; p++) {
            const b64 = await pageToBase64(convert, p, tempFiles);
            if (b64) allImgs.push(b64); else break;
          }
          if (allImgs.length > 3) {
            const ultimas = allImgs.slice(-2);
            extraido = await extraerConVision(groqApiKey, ultimas);
          }
        }

        if (extraido) {
          if (extraido.titulo && !titulo?.trim()) titulo = extraido.titulo;
          if (extraido.diseñadora && !diseñadora?.trim()) diseñadora = extraido.diseñadora;
        }
      }
    }

    // Análisis de texto: duplicados + categoría + idioma
    const patrones = await new Promise((resolve, reject) => {
      db.all('SELECT id, titulo FROM patrones WHERE activo = 1 ORDER BY created_at DESC LIMIT 300', [], (err, rows) => {
        if (err) reject(err); else resolve(rows || []);
      });
    });

    const titulosList = patrones.map(p => `"${p.titulo}" [${p.id}]`).join('\n');

    const prompt = `Analiza este patrón de crochet y responde SOLO con JSON válido (sin texto adicional).

PATRÓN:
Título: "${titulo || '(sin título)'}"
${descripcion ? `Descripción: "${descripcion}"` : ''}

CATEGORÍAS VÁLIDAS: amigurumi, ropa, accesorios, decoracion, hogar, otro
SUBCATEGORÍAS (solo si categoría=amigurumi): animales, personas y muñecos, comida, plantas y flores, personajes y fantasía, navidad, otro
IDIOMAS: es, en, pt, fr, de, it, otro

PATRONES YA EXISTENTES:
${titulosList}

Responde exactamente con este JSON:
{"idioma":"es","categoria":"amigurumi","subcategoria":"animales","duplicados":[{"id":"...","titulo":"...","similitud":0.9}]}

Reglas:
- duplicados: solo incluye si similitud >= 0.75, array vacío si no hay
- subcategoria: "" si la categoría no es amigurumi`;

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 600 },
      { headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    const content = groqRes.data.choices[0].message.content.trim();
    let resultado;
    try {
      const match = content.match(/\{[\s\S]*\}/);
      resultado = JSON.parse(match ? match[0] : content);
    } catch {
      resultado = { idioma: 'es', categoria: 'otro', subcategoria: '', duplicados: [] };
    }

    res.json({ titulo: titulo || null, diseñadora: diseñadora || null, ...resultado });
  } catch (err) {
    console.error('Error /admin/patrones/analizar:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Error en análisis IA' });
  } finally {
    tempFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
  }
});

// ── Subir patrón ──────────────────────────────────────────────────────────────

router.post('/patrones', verifyAdmin, upload.single('pdf'), async (req, res) => {
  const pdfPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún PDF' });

    const { titulo, descripcion, autor, diseñadora, categoria, subcategoria,
            dificultad, idioma, tiempo_minutos, es_preview, es_solo_premium, esPremium } = req.body;

    if (!titulo || !categoria) {
      fs.unlinkSync(pdfPath);
      return res.status(400).json({ error: 'Título y categoría son obligatorios' });
    }

    // Hash para detectar duplicados exactos
    const pdfHash = crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex');
    const hashExistente = await new Promise((resolve, reject) => {
      db.get('SELECT id, titulo FROM patrones WHERE pdf_hash = ?', [pdfHash], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (hashExistente) {
      fs.unlinkSync(pdfPath);
      return res.status(409).json({ error: `PDF duplicado: ya existe "${hashExistente.titulo}"`, patronExistente: hashExistente });
    }

    const patronId = `patron-${uuidv4()}`;
    const { fromPath } = require('pdf2pic');
    const patronDir = path.join(__dirname, '../../uploads/patrones', patronId);
    if (!fs.existsSync(patronDir)) fs.mkdirSync(patronDir, { recursive: true });

    const convert = fromPath(pdfPath, {
      density: 150,
      saveFilename: 'pagina',
      savePath: patronDir,
      format: 'jpeg',
      width: 1200,
      height: 1600,
    });

    const response = await convert.bulk(-1);
    const totalPaginas = response.length;

    // Insertar patrón
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO patrones (id, titulo, descripcion, autor, diseñadora, categoria, subcategoria,
          dificultad, idioma, tiempo_minutos, es_preview, es_premium, es_solo_premium, pdf_hash, paginas, activo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
        [patronId, titulo, descripcion || '', autor || '', diseñadora || '',
         categoria, subcategoria || '', dificultad || 'principiante', idioma || 'es',
         parseInt(tiempo_minutos) || null,
         es_preview === 'true' ? 1 : 0,
         esPremium === 'true' ? 1 : 0,
         es_solo_premium === 'true' ? 1 : 0,
         pdfHash, totalPaginas],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });

    // Insertar páginas
    for (let i = 0; i < totalPaginas; i++) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?, ?, ?, ?)',
          [uuidv4(), patronId, i + 1, `patrones/${patronId}/pagina_${i + 1}.jpg`],
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
    }

    // Eliminar PDF original (ya convertido)
    fs.unlinkSync(pdfPath);

    res.json({ success: true, patron: { id: patronId, titulo, categoria, paginas: totalPaginas } });

  } catch (err) {
    console.error('Error subiendo patrón:', err);
    if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    res.status(500).json({ error: 'Error procesando el patrón: ' + err.message });
  }
});

router.get('/patrones', verifyAdmin, async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, titulo, categoria, es_premium, es_solo_premium, paginas, created_at FROM patrones ORDER BY created_at DESC',
        [],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows);
        }
      );
    });
    res.json({ patrones });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/patrones/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM patrones WHERE id = ?', [id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });

    // Eliminar carpeta de imágenes del patrón
    const patronDir = path.join(__dirname, '../../uploads/patrones', id);
    if (fs.existsSync(patronDir)) fs.rmSync(patronDir, { recursive: true, force: true });

    // Eliminar páginas y patrón de la BD
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM paginas WHERE patron_id = ?', [id], function(err) { if (err) reject(err); else resolve(); });
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM patrones WHERE id = ?', [id], function(err) { if (err) reject(err); else resolve(); });
    });

    res.json({ success: true, message: 'Patrón eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT
          (SELECT COUNT(*) FROM patrones WHERE activo = 1) as total,
          (SELECT COUNT(*) FROM patrones WHERE activo = 1 AND paginas > 0) as convertidos,
          (SELECT COUNT(*) FROM patrones WHERE activo = 1 AND paginas = 0) as pendientes,
          (SELECT COUNT(*) FROM patrones WHERE pdf_corrupto = 1) as corruptos,
          (SELECT COUNT(*) FROM patrones WHERE verificado = 1) as verificados,
          (SELECT COUNT(*) FROM patrones WHERE destacado = 1) as heroes,
          (SELECT COUNT(*) FROM patrones WHERE tendencia = 1) as tendencia,
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE tier = 'premium') as premium_users,
          (SELECT COUNT(*) FROM users WHERE tier != 'premium') as usuariosFree`,
        [],
        (err, r) => { if (err) reject(err); else resolve(r); }
      );
    });

    const porCategoria = await new Promise((resolve, reject) => {
      db.all(
        `SELECT categoria, COUNT(*) as n FROM patrones WHERE activo = 1 GROUP BY categoria ORDER BY n DESC`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    res.json({
      total: row.total || 0,
      convertidos: row.convertidos || 0,
      pendientes: row.pendientes || 0,
      corruptos: row.corruptos || 0,
      archivosBot: 0,
      verificados: row.verificados || 0,
      heroes: row.heroes || 0,
      tendencia: row.tendencia || 0,
      porCategoria,
      dmca_pendientes: 0,
      metadatosRunning: false,
      groqRunning: false,
      categoriasRunning: false,
      openaiRunning: false,
      total_users: row.total_users || 0,
      premium_users: row.premium_users || 0,
      usuariosFree: row.usuariosFree || 0,
    });
  } catch (err) {
    console.error('Error /admin/stats:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;