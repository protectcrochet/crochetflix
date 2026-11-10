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
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Acepta el PDF en el campo 'file' (bot de Telegram) o 'pdf' (panel admin)
const subirPdf = [
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  (req, res, next) => {
    req.file = req.files?.file?.[0] || req.files?.pdf?.[0];
    next();
  },
];

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

// OCR local con Tesseract para extraer texto de imágenes (gratis, sin API)
function extraerConOCR(base64Images) {
  if (!base64Images.length) return '';
  const { execSync } = require('child_process');
  const textos = [];

  for (const b64 of base64Images) {
    try {
      const tmpFile = `/tmp/ocr_${crypto.randomBytes(4).toString('hex')}.jpg`;
      fs.writeFileSync(tmpFile, Buffer.from(b64, 'base64'));

      const texto = execSync(`timeout -s KILL 25 tesseract "${tmpFile}" stdout -l eng+spa`,
        { timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

      textos.push(texto);
      try { fs.unlinkSync(tmpFile); } catch {}
    } catch (e) {
      console.log('[OCR] error:', e.message);
    }
  }

  return textos.join('\n\n');
}

// Extrae título y diseñadora usando OCR + modelo de texto Groq
async function extraerConVision(groqApiKey, base64Images) {
  if (!base64Images.length) return null;
  try {
    // Extraer texto con OCR local
    const textoExtraido = extraerConOCR(base64Images);
    if (!textoExtraido || textoExtraido.replace(/\s+/g, '').length < 20) {
      console.log('[analizar] OCR sin texto suficiente');
      return null;
    }

    // Enviar texto extraído a Groq para parsear título y diseñadora
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'gemma-7b-it',
        messages: [{
          role: 'user',
          content: `Del siguiente texto de un patrón de crochet, extrae el título exacto y el nombre del/la diseñador/a. Si no encuentras algo, pon null. Responde SOLO con JSON: {"titulo": "...", "diseñadora": "..."}\n\nTEXTO:\n${textoExtraido}`,
        }],
        temperature: 0.1,
        max_tokens: 150,
      },
      { headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' }, timeout: 25000 }
    );

    try { require('../utils/apiUso').registrarUso('groq', res.data.usage?.total_tokens); } catch (e) {}
    const text = res.data.choices[0].message.content.trim();
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return (parsed.titulo || parsed.diseñadora) ? parsed : null;
  } catch (err) {
    console.error('Error extracción:', err?.response?.data?.error || err.message);
    return null;
  }
}

// ── Endpoint: analizar patrón antes de subir ────────────────────────────────

router.post('/patrones/analizar', verifyAdmin, subirPdf, async (req, res) => {
  try {
    const { titulo, categoria, diseñadora } = req.body;
    res.json({ titulo: titulo || null, diseñadora: diseñadora || null, categoria: categoria || 'General', idioma: 'es', duplicados: [] });
  } catch (err) {
    res.status(500).json({ error: 'Error en análisis' });
  } finally {
    // El PDF solo se sube para analizarlo; sin esto se acumula uno por cada análisis
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});


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

        const imgFiles = fs.readdirSync(patronDir)
          .filter(f => /\.(jpg|jpeg)$/i.test(f))
          .sort((a, b) => {
            const n = s => parseInt(s.match(/(\d+)/)?.[1] || '0');
            return n(a) - n(b);
          });

        const base64Images = imgFiles.slice(0, 3).map(f =>
          fs.readFileSync(path.join(patronDir, f)).toString('base64')
        );

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

router.post('/patrones', verifyAdmin, subirPdf, async (req, res) => {
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
    const patronDir = path.join(__dirname, '../../uploads/patrones', patronId);
    if (!fs.existsSync(patronDir)) fs.mkdirSync(patronDir, { recursive: true });

    const { execSync } = require('child_process');
    execSync(`pdftoppm -jpeg -r 150 "${pdfPath}" "${path.join(patronDir, 'pagina')}"`, { timeout: 60000 });
    
    const totalPaginas = fs.readdirSync(patronDir).filter(f => f.endsWith('.jpg')).length;
    const thumbnailPath = `/uploads/patrones/${patronId}/pagina_1.jpg`;

    // Renombrar archivos al formato estándar pagina_N.jpg
    for (let i = 1; i <= totalPaginas; i++) {
      const oldPath = [1, 2, 3, 4].map(w => path.join(patronDir, `pagina-${String(i).padStart(w, '0')}.jpg`)).find(f => fs.existsSync(f)) || '';
      const newPath = path.join(patronDir, `pagina_${i}.jpg`);
      if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
    }

    // Insertar patrón
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO patrones (id, titulo, descripcion, autor, diseñadora, categoria, subcategoria,
          dificultad, idioma, tiempo_minutos, es_preview, es_premium, es_solo_premium, pdf_hash, paginas, thumbnail_path, activo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
        [patronId, titulo, descripcion || '', autor || '', diseñadora || '',
         categoria, subcategoria || '', dificultad || 'principiante', idioma || 'es',
         parseInt(tiempo_minutos) || null,
         es_preview === 'true' ? 1 : 0,
         esPremium === 'true' ? 1 : 0,
         es_solo_premium === 'true' ? 1 : 0,
         pdfHash, totalPaginas, thumbnailPath],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });

    // Insertar páginas con el nombre estándar
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

router.get('/patrones/recientes', verifyAdmin, async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 7;
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, titulo, autor, diseñadora, categoria, subcategoria, dificultad,
                paginas, activo, es_premium, es_solo_premium, pdf_corrupto,
                verificado, destacado, tendencia, thumbnail_path, created_at
         FROM patrones
         WHERE created_at >= datetime('now', ?)
         ORDER BY created_at DESC`,
        [`-${dias} days`],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
    res.json({ patrones });
  } catch (err) {
    console.error('Error /admin/patrones/recientes:', err.message);
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
               u.last_login_at, u.login_count, u.email_verified,
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
               (SELECT COUNT(*) FROM traducciones_uso t WHERE t.user_id = u.id) as traducciones_usadas
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

// ── Panel: uso de APIs (Groq + Cerebras) ──────────────────────────
let _limitesCache = { data: null, ts: 0 };
function _num(h, k) { const v = h && h[k]; return v === undefined ? null : Number(v); }
async function _probe(url, model, key) {
  try {
    const r = await axios.post(url,
      { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 15000 });
    return r.headers;
  } catch (e) {
    if (e.response && e.response.headers) return e.response.headers;
    throw e;
  }
}
router.get('/limites-api', verifyAdmin, async (req, res) => {
  const now = Date.now();
  if (_limitesCache.data && now - _limitesCache.ts < 120000)
    return res.json({ ..._limitesCache.data, cache: true });
  const out = { groq: null, cerebras: null, ts: new Date().toISOString() };
  try {
    const h = await _probe('https://api.groq.com/openai/v1/chat/completions',
      'gemma-7b-it', process.env.GROQ_API_KEY);
    out.groq = {
      req_limit_dia: _num(h, 'x-ratelimit-limit-requests'),
      req_rest_dia: _num(h, 'x-ratelimit-remaining-requests'),
      tok_limit_min: _num(h, 'x-ratelimit-limit-tokens'),
      tok_rest_min: _num(h, 'x-ratelimit-remaining-tokens'),
    };
  } catch (e) { out.groq = { error: (e.response && e.response.status) || e.message }; }
  try {
    const h = await _probe('https://api.cerebras.ai/v1/chat/completions',
      'gemma-4-31b', process.env.CEREBRAS_API_KEY);
    out.cerebras = {
      req_limit_dia: _num(h, 'x-ratelimit-limit-requests-day'),
      req_rest_dia: _num(h, 'x-ratelimit-remaining-requests-day'),
      tok_limit_dia: _num(h, 'x-ratelimit-limit-tokens-day'),
      tok_rest_dia: _num(h, 'x-ratelimit-remaining-tokens-day'),
      req_limit_min: _num(h, 'x-ratelimit-limit-requests-minute'),
      req_rest_min: _num(h, 'x-ratelimit-remaining-requests-minute'),
    };
  } catch (e) { out.cerebras = { error: (e.response && e.response.status) || e.message }; }
  try { const u = require('../utils/apiUso'); out.uso_hoy = { fecha: u.hoyStr(), groq: await u.getUsoHoy('groq'), cerebras: await u.getUsoHoy('cerebras') }; } catch (e) {}
  _limitesCache = { data: out, ts: now };
  res.json({ ...out, cache: false });
});

router.get('/campana', verifyAdmin, async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 30;
    const desde = `-${dias} days`;
    const stats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE trial_campana = 1 AND created_at >= datetime('now', ?)) as registros,
          (SELECT COUNT(*) FROM users WHERE trial_campana = 1 AND created_at >= datetime('now', ?) AND stripe_subscription_id IS NOT NULL) as con_tarjeta,
          (SELECT COUNT(*) FROM users WHERE trial_campana = 1 AND created_at >= datetime('now', ?) AND tier = 'premium' AND subscription_expires_at > datetime('now')) as premium_activo,
          (SELECT COUNT(*) FROM users WHERE trial_campana = 1 AND created_at >= datetime('now', ?) AND trial_gratis_usado = 1 AND stripe_subscription_id IS NULL) as trial_24h,
          (SELECT COUNT(DISTINCT p.user_id) FROM pagos p JOIN users u ON u.id = p.user_id WHERE u.trial_campana = 1 AND u.created_at >= datetime('now', ?) AND p.status = 'paid') as con_pago`,
        [desde, desde, desde, desde, desde],
        (err, row) => { if (err) reject(err); else resolve(row); });
    });
    res.json({ dias, ...stats });
  } catch (err) {
    console.error('Error /admin/campana:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

let _subsCache = { data: null, ts: 0 };
router.get('/suscripciones', verifyAdmin, async (req, res) => {
  const now = Date.now();
  if (_subsCache.data && now - _subsCache.ts < 300000) return res.json({ ..._subsCache.data, cache: true });
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let subs = [], starting_after;
    while (true) {
      const page = await stripe.subscriptions.list({ status: 'all', limit: 100, ...(starting_after ? { starting_after } : {}) });
      subs = subs.concat(page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1].id;
    }
    const porEstado = {};
    subs.forEach(s => porEstado[s.status] = (porEstado[s.status] || 0) + 1);
    const activas = subs.filter(s => s.status === 'active' || s.status === 'trialing');
    const cancPorMes = {};
    subs.filter(s => s.canceled_at).forEach(s => {
      const m = new Date(s.canceled_at * 1000).toISOString().slice(0, 7);
      cancPorMes[m] = (cancPorMes[m] || 0) + 1;
    });
    let mrr = 0;
    activas.forEach(s => {
      const price = s.items && s.items.data && s.items.data[0] && s.items.data[0].price;
      if (price && price.unit_amount) {
        let monthly = price.unit_amount / 100;
        if (price.recurring && price.recurring.interval === 'year') monthly = monthly / 12;
        mrr += monthly;
      }
    });
    const mesActual = new Date().toISOString().slice(0, 7);
    const cancMes = cancPorMes[mesActual] || 0;
    const churnMes = (activas.length + cancMes) > 0 ? (cancMes / (activas.length + cancMes)) * 100 : 0;
    const out = {
      total: subs.length,
      activas: activas.length,
      past_due: porEstado['past_due'] || 0,
      canceladas: porEstado['canceled'] || 0,
      mrr: Math.round(mrr),
      cancPorMes,
      churnMes: Math.round(churnMes * 10) / 10,
      mesActual,
      ts: new Date().toISOString(),
    };
    _subsCache = { data: out, ts: now };
    res.json({ ...out, cache: false });
  } catch (err) {
    console.error('Error /admin/suscripciones:', err.message);
    res.status(500).json({ error: 'Error consultando Stripe: ' + err.message });
  }
});

module.exports = router;
module.exports.groqRunning = false;
Object.defineProperty(module.exports, 'groqRunning', {
  get: () => groqRunning,
});