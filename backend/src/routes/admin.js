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

let groqRunning = false;
let groqProgreso = { actualizados: 0, restantes: 0 };

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
      db.all('SELECT id, titulo FROM patrones WHERE activo = 1 ORDER BY created_at DESC LIMIT 50', [], (err, rows) => {
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

// ── Groq: extracción masiva de metadatos ──────────────────────────────────────

router.post('/patrones/extraer-metadatos-groq', verifyAdmin, async (req, res) => {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return res.status(500).json({ error: 'GROQ_API_KEY no configurada' });

  if (groqRunning) {
    return res.json({ message: `Groq ya está corriendo (${groqProgreso.restantes} restantes)` });
  }

  let pendientes;
  try {
    pendientes = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo, diseñadora FROM patrones
         WHERE activo = 1 AND paginas > 0
           AND (titulo IS NULL OR titulo = '' OR titulo LIKE '%.pdf' OR titulo LIKE '%patron-%'
                OR diseñadora IS NULL OR diseñadora = '')
         ORDER BY created_at DESC`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando patrones' });
  }

  if (!pendientes.length) {
    return res.json({ message: 'No hay patrones pendientes de análisis Groq' });
  }

  groqRunning = true;
  groqProgreso = { actualizados: 0, restantes: pendientes.length };
  res.json({ message: `Iniciando análisis Groq para ${pendientes.length} patrones…` });

  const uploadsDir = path.join(__dirname, '../../uploads');

  (async () => {
    for (const patron of pendientes) {
      try {
        const patronDir = path.join(uploadsDir, 'patrones', patron.id);
        if (!fs.existsSync(patronDir)) { groqProgreso.restantes--; continue; }

        const base64Images = [];
        for (let p = 1; p <= 3; p++) {
          const imgPath = path.join(patronDir, `pagina_${p}.jpg`);
          if (!fs.existsSync(imgPath)) break;
          base64Images.push(fs.readFileSync(imgPath).toString('base64'));
        }

        if (!base64Images.length) { groqProgreso.restantes--; continue; }

        const extraido = await extraerConVision(groqApiKey, base64Images);

        if (extraido) {
          // Prefer Groq's extracted value; fall back to what's already in DB
          const nuevoTitulo = extraido.titulo || patron.titulo;
          const nuevaDiseñadora = extraido.diseñadora || patron.diseñadora;
          await new Promise(resolve => {
            db.run(
              `UPDATE patrones SET titulo = ?, diseñadora = ? WHERE id = ?`,
              [nuevoTitulo || '', nuevaDiseñadora || '', patron.id],
              () => resolve()
            );
          });
          groqProgreso.actualizados++;
        }

        groqProgreso.restantes--;
        // Respect Groq rate limits: ~2s between vision calls
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[Groq batch] Error en ${patron.id}:`, err.message);
        groqProgreso.restantes--;
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    groqRunning = false;
    console.log(`[Groq batch] Completado: ${groqProgreso.actualizados} actualizados`);
  })();
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
        `SELECT id, titulo, descripcion, autor, diseñadora, categoria, subcategoria,
                dificultad, idioma, tiempo_minutos, paginas, activo, es_preview,
                es_premium, es_solo_premium, pdf_hash, pdf_corrupto, conversion_intentos,
                destacado, tendencia, verificado, hero_position, thumbnail_path, created_at
         FROM patrones ORDER BY created_at DESC`,
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
          (SELECT COUNT(*) FROM users WHERE tier = 'premium' AND subscription_expires_at > datetime('now')) as premium_users,
          (SELECT COUNT(*) FROM users WHERE tier != 'premium' OR subscription_expires_at <= datetime('now') OR subscription_expires_at IS NULL) as usuariosFree`,
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
      metadatosRunning: groqRunning,
      groqRunning,
      groqProgreso,
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

// ── Email manual de confirmación de pago ──────────────────────────────────────

router.post('/usuarios/:id/enviar-confirmacion-pago', verifyAdmin, async (req, res) => {
  try {
    const usuario = await new Promise((resolve, reject) => {
      db.get('SELECT email, tier, subscription_expires_at FROM users WHERE id = ?', [req.params.id],
        (err, row) => { if (err) reject(err); else resolve(row); });
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario.tier !== 'premium' || !usuario.subscription_expires_at) {
      return res.status(400).json({ error: 'El usuario no tiene premium activo' });
    }
    const { enviarConfirmacionPago } = require('../services/email');
    await enviarConfirmacionPago(usuario.email, usuario.subscription_expires_at);
    res.json({ success: true, email: usuario.email });
  } catch (err) {
    console.error('Error enviando confirmación pago:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Usuarios ──────────────────────────────────────────────────────────────────

router.get('/usuarios', verifyAdmin, async (req, res) => {
  try {
    const usuarios = await new Promise((resolve, reject) => {
      db.all(`
        SELECT u.id, u.email, u.tier, u.subscription_expires_at, u.created_at,
               u.last_login_at, u.login_count,
               (SELECT COUNT(*) FROM progreso p WHERE p.user_id = u.id) as patrones_abiertos,
               (SELECT COUNT(*) FROM mi_lista m WHERE m.user_id = u.id) as en_lista
        FROM users u
        ORDER BY u.created_at DESC
      `, [], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    res.json({ usuarios });
  } catch (err) {
    console.error('Error /admin/usuarios:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/usuarios/premium', verifyAdmin, async (req, res) => {
  try {
    const usuarios = await new Promise((resolve, reject) => {
      db.all(`
        SELECT u.id, u.email, u.subscription_expires_at, u.last_login_at,
               (SELECT COUNT(*) FROM progreso p WHERE p.user_id = u.id) as patrones_leidos,
               (SELECT COUNT(*) FROM progreso p WHERE p.user_id = u.id AND p.completado = 1) as patrones_completados,
               (SELECT COUNT(*) FROM mi_lista m WHERE m.user_id = u.id) as en_mi_lista,
               0 as traducciones_usadas
        FROM users u
        WHERE u.tier = 'premium'
        ORDER BY u.subscription_expires_at ASC
      `, [], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    res.json({ usuarios });
  } catch (err) {
    console.error('Error /admin/usuarios/premium:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/usuarios/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, email, tier, subscription_expires_at, created_at, last_login_at FROM users WHERE id = ?`,
        [id], (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const patrones = await new Promise((resolve, reject) => {
      db.all(`
        SELECT pr.patron_id as id, pat.titulo, pat.paginas, pr.pagina_actual, pr.completado, pr.ultimo_acceso
        FROM progreso pr
        LEFT JOIN patrones pat ON pat.id = pr.patron_id
        WHERE pr.user_id = ?
        ORDER BY pr.ultimo_acceso DESC
      `, [id], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });

    res.json({ usuario, patrones });
  } catch (err) {
    console.error('Error /admin/usuarios/:id:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/usuarios/:id/tier', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;
    if (!['free', 'premium'].includes(tier)) {
      return res.status(400).json({ error: 'Tier inválido' });
    }
    const expires = tier === 'premium'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET tier = ?, subscription_expires_at = ? WHERE id = ?`,
        [tier, expires, id], function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ tier, subscription_expires_at: expires });
  } catch (err) {
    console.error('Error PATCH /admin/usuarios/:id/tier:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/usuarios/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    for (const sql of [
      `DELETE FROM progreso WHERE user_id = ?`,
      `DELETE FROM mi_lista WHERE user_id = ?`,
      `DELETE FROM preview_mensual WHERE user_id = ?`,
      `DELETE FROM pagos WHERE user_id = ?`,
      `DELETE FROM users WHERE id = ?`,
    ]) {
      await new Promise((resolve, reject) => {
        db.run(sql, [id], (err) => { if (err) reject(err); else resolve(); });
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error DELETE /admin/usuarios/:id:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', verifyAdmin, async (req, res) => {
  try {
    const hoy    = new Date().toISOString().slice(0, 10);
    const hace7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const hace5  = new Date(Date.now() - 5  * 86400000).toISOString().slice(0, 10);

    const [main, visitasPorDia, usuariosPorDia, topPatrones] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get(`
          SELECT
            (SELECT COUNT(*)               FROM progreso WHERE date(ultimo_acceso) = ?)  as visitasHoy,
            (SELECT COUNT(DISTINCT user_id) FROM progreso WHERE date(ultimo_acceso) = ?)  as usuariosUnicosHoy,
            (SELECT COUNT(*) FROM users WHERE tier = 'free' OR subscription_expires_at <= datetime('now') OR subscription_expires_at IS NULL) as usuariosFree,
            (SELECT COUNT(*) FROM users WHERE tier = 'premium' AND subscription_expires_at > datetime('now')) as usuariosPremium,
            (SELECT COUNT(*)               FROM progreso WHERE date(ultimo_acceso) >= ?) as visitasSemana,
            (SELECT COUNT(DISTINCT user_id) FROM progreso WHERE date(ultimo_acceso) >= ?) as usuariosUnicosSemana,
            (SELECT COUNT(*) FROM users WHERE date(created_at) = ?)                      as registrosHoy,
            (SELECT COUNT(*) FROM users WHERE date(created_at) >= ?)                     as registrosSemana,
            (SELECT COUNT(*)               FROM progreso WHERE date(ultimo_acceso) >= ?) as apertuasMes,
            (SELECT COUNT(DISTINCT user_id) FROM progreso WHERE date(ultimo_acceso) >= ?) as usuariosUnicosMes,
            (SELECT COUNT(*) FROM users WHERE tier = 'free'    AND id NOT IN (SELECT DISTINCT user_id FROM progreso WHERE date(ultimo_acceso) >= ?)) as inactivosFree,
            (SELECT COUNT(*) FROM users WHERE tier = 'premium' AND id NOT IN (SELECT DISTINCT user_id FROM progreso WHERE date(ultimo_acceso) >= ?)) as inactivosPremium
        `, [hoy, hoy, hace7, hace7, hoy, hace7, hace30, hace30, hace5, hace5],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      }),

      new Promise((resolve, reject) => {
        db.all(`
          SELECT date(ultimo_acceso) as dia, COUNT(*) as visitas
          FROM progreso WHERE date(ultimo_acceso) >= ?
          GROUP BY date(ultimo_acceso) ORDER BY dia ASC
        `, [hace30], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
      }),

      new Promise((resolve, reject) => {
        db.all(`
          SELECT date(ultimo_acceso) as dia, COUNT(DISTINCT user_id) as usuarios
          FROM progreso WHERE date(ultimo_acceso) >= ?
          GROUP BY date(ultimo_acceso) ORDER BY dia ASC
        `, [hace30], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
      }),

      new Promise((resolve, reject) => {
        db.all(`
          SELECT pr.patron_id, pat.titulo, COUNT(*) as visitas
          FROM progreso pr
          LEFT JOIN patrones pat ON pat.id = pr.patron_id
          GROUP BY pr.patron_id ORDER BY visitas DESC LIMIT 10
        `, [], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
      }),
    ]);

    res.json({ ...main, visitasPorDia, usuariosPorDia, topPatrones, paises: [] });
  } catch (err) {
    console.error('Error /admin/analytics:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Editar patrón ─────────────────────────────────────────────────────────────

router.patch('/patrones/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, autor, diseñadora, categoria, subcategoria,
            dificultad, idioma, tiempo_minutos, es_preview, es_solo_premium } = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE patrones SET
          titulo = COALESCE(?, titulo),
          descripcion = COALESCE(?, descripcion),
          autor = COALESCE(?, autor),
          diseñadora = COALESCE(?, diseñadora),
          categoria = COALESCE(?, categoria),
          subcategoria = COALESCE(?, subcategoria),
          dificultad = COALESCE(?, dificultad),
          idioma = COALESCE(?, idioma),
          tiempo_minutos = COALESCE(?, tiempo_minutos),
          es_preview = COALESCE(?, es_preview),
          es_solo_premium = COALESCE(?, es_solo_premium)
        WHERE id = ?`,
        [titulo, descripcion, autor, diseñadora, categoria, subcategoria,
         dificultad, idioma, tiempo_minutos,
         es_preview !== undefined ? (es_preview ? 1 : 0) : null,
         es_solo_premium !== undefined ? (es_solo_premium ? 1 : 0) : null,
         id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error PATCH /admin/patrones/:id:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/patrones/:id/toggle', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT activo FROM patrones WHERE id = ?', [id], (err, r) => { if (err) reject(err); else resolve(r); });
    });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET activo = ? WHERE id = ?', [row.activo ? 0 : 1, id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ activo: !row.activo });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/patrones/:id/destacar', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT destacado FROM patrones WHERE id = ?', [id], (err, r) => { if (err) reject(err); else resolve(r); });
    });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET destacado = ? WHERE id = ?', [row.destacado ? 0 : 1, id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ destacado: !row.destacado });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/patrones/:id/tendencia', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT tendencia FROM patrones WHERE id = ?', [id], (err, r) => { if (err) reject(err); else resolve(r); });
    });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET tendencia = ? WHERE id = ?', [row.tendencia ? 0 : 1, id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ tendencia: !row.tendencia });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/patrones/:id/verificar', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT verificado FROM patrones WHERE id = ?', [id], (err, r) => { if (err) reject(err); else resolve(r); });
    });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET verificado = ? WHERE id = ?', [row.verificado ? 0 : 1, id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ verificado: !row.verificado });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/patrones/:id/hero-position', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { hero_position } = req.body;
    await new Promise((resolve, reject) => {
      db.run('UPDATE patrones SET hero_position = ? WHERE id = ?', [hero_position, id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── DMCA admin ────────────────────────────────────────────────────────────────

router.get('/dmca', verifyAdmin, async (req, res) => {
  try {
    const claims = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM dmca_claims ORDER BY created_at DESC`, [],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    res.json(claims);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/dmca/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_notes, restore_patron } = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE dmca_claims SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes),
         updated_at = datetime('now') WHERE id = ?`,
        [status, admin_notes, id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    if (restore_patron) {
      const claim = await new Promise((resolve, reject) => {
        db.get('SELECT patron_id FROM dmca_claims WHERE id = ?', [id], (err, r) => { if (err) reject(err); else resolve(r); });
      });
      if (claim?.patron_id) {
        await new Promise((resolve, reject) => {
          db.run('UPDATE patrones SET activo = 1 WHERE id = ?', [claim.patron_id],
            function(err) { if (err) reject(err); else resolve(); });
        });
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Colecciones admin ─────────────────────────────────────────────────────────

router.get('/colecciones', verifyAdmin, async (req, res) => {
  try {
    const cols = await new Promise((resolve, reject) => {
      db.all(
        `SELECT c.*,
          (SELECT COUNT(*) FROM coleccion_patrones cp WHERE cp.coleccion_id = c.id) as total_patrones
         FROM colecciones c ORDER BY c.orden ASC, c.created_at DESC`,
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
    res.json(cols);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/colecciones/:id/patrones', verifyAdmin, async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id, p.titulo, p.thumbnail_path, cp.orden
         FROM patrones p JOIN coleccion_patrones cp ON cp.patron_id = p.id
         WHERE cp.coleccion_id = ? ORDER BY cp.orden ASC`,
        [req.params.id],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
    res.json(patrones);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/colecciones', verifyAdmin, async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { nombre, descripcion, emoji, orden } = req.body;
    const id = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO colecciones (id, nombre, descripcion, emoji, orden) VALUES (?,?,?,?,?)`,
        [id, nombre, descripcion || '', emoji || '🧶', orden || 0],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ id, nombre });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.patch('/colecciones/:id', verifyAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, emoji, orden, activo } = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE colecciones SET
          nombre = COALESCE(?, nombre),
          descripcion = COALESCE(?, descripcion),
          emoji = COALESCE(?, emoji),
          orden = COALESCE(?, orden),
          activa = COALESCE(?, activa)
         WHERE id = ?`,
        [nombre, descripcion, emoji || null, orden, activo !== undefined ? (activo ? 1 : 0) : null, req.params.id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/colecciones/:id', verifyAdmin, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM coleccion_patrones WHERE coleccion_id = ?', [req.params.id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM colecciones WHERE id = ?', [req.params.id],
        function(err) { if (err) reject(err); else resolve(); });
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/colecciones/:id/patrones', verifyAdmin, async (req, res) => {
  try {
    const { patron_id, orden } = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO coleccion_patrones (coleccion_id, patron_id, orden) VALUES (?,?,?)`,
        [req.params.id, patron_id, orden || 0],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/colecciones/:id/patrones/:patron_id', verifyAdmin, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM coleccion_patrones WHERE coleccion_id = ? AND patron_id = ?',
        [req.params.id, req.params.patron_id],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
module.exports.groqRunning = false;
Object.defineProperty(module.exports, 'groqRunning', {
  get: () => groqRunning,
});