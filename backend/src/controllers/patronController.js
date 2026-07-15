const db = require('../models');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');


const SIN_LIMITE_TRADUCCION = new Set(['jeramgon@outlook.com']);

const dbGet = (sql, p) => new Promise((res, rej) => db.get(sql, p, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, p) => new Promise((res, rej) => db.run(sql, p, function(err) { err ? rej(err) : res(this); }));

const SISTEMAS = {
  es: `Eres un traductor profesional de patrones de crochet al español mexicano.
REGLAS:
1. Traduce TODO el texto al español. Ninguna palabra puede quedar en otro idioma.
2. Abreviaturas de crochet — usa EXACTAMENTE estas, sin excepción: sc→pb, dc→pa, hdc→mpa, tr→pad, sl st→pd, ch→cad, inc→aum, dec→dism, sc2tog→pb2jun, BLO→hta, FLO→hte, MR→anillo mágico, yo→hp, rnd→vta, rep→rep, sts→p.
3. PROHIBIDO usar caracteres chinos, japoneses, coreanos, árabes o cualquier otro alfabeto no latino. Solo letras del español y números.
4. Conserva el formato exacto: saltos de línea, numeración de vueltas, paréntesis con conteos.
5. Responde ÚNICAMENTE con el texto traducido.`,
  en: `You are a professional crochet pattern translator to English.
RULES:
1. Translate EVERYTHING to English. No Spanish words in the output.
2. US abbreviations: pb→sc, pa→dc, mpa→hdc, pad→tr, pd→sl st, cad→ch, aum→inc, dism→dec, MR→magic ring, vta→rnd, sts→sts.
3. Preserve exact format: line breaks, round numbering, stitch counts in parentheses.
4. Reply ONLY with the translated text.`,
  pt: `Você é um tradutor de padrões de crochê para o português brasileiro.
REGRAS:
1. Traduza TUDO para o português. Nenhuma palavra em espanhol.
2. Abreviações: sc→pb, dc→pa, sl st→pp, ch→cad, inc→aum, dec→dim, MR→AM, rnd→v.
3. Conserve o formato exato. Responda APENAS com o texto traduzido.`,
  fr: `Vous êtes un traducteur de patrons de crochet en français.
RÈGLES:
1. Traduisez TOUT en français. Aucun mot espagnol.
2. Abréviations: sc→ms, dc→br, sl st→mc, ch→ml, inc→aug, dec→dim, MR→AM, rnd→rg.
3. Conservez le format exact. Répondez UNIQUEMENT avec le texte traduit.`,
  ru: `Вы — переводчик схем вязания крючком на русский язык.
ПРАВИЛА:
1. Переведите ВСЁ на русский. Никаких испанских слов.
2. Сокращения: sc→сбн, dc→стн, sl st→сс, ch→вп, inc→пр, dec→уб, MR→КА, rnd→ряд.
3. Сохраняйте формат. Отвечайте ТОЛЬКО переведённым текстом.`,
};

function getGroqKeys() {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  const legacy = process.env.GROQ_API_KEY_TRADUCCION || process.env.GROQ_API_KEY;
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  return keys;
}

async function groqPost(payload, maxIntentos = 3) {
  const keys = getGroqKeys();
  if (!keys.length) throw new Error('GROQ_API_KEY no configurado');

  for (const key of keys) {
    try {
      for (let intento = 0; intento < maxIntentos; intento++) {
        try {
          const resp = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            payload,
            { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 90000 }
          );
          return resp.data.choices[0].message.content.trim();
        } catch (e) {
          if (e.response?.status === 429) throw e; // saltar al siguiente key
          if (intento < maxIntentos - 1) continue;
          throw e;
        }
      }
    } catch (e) {
      if (e.response?.status === 429) {
        console.log(`[groq] key agotada, probando siguiente...`);
        continue;
      }
      throw e;
    }
  }
  throw new Error('rate_limit'); // todos los keys agotados
}

function getCerebrasKeys() {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`CEREBRAS_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  const legacy = process.env.CEREBRAS_API_KEY;
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  return keys;
}

async function cerebrasPost(payload) {
  const keys = getCerebrasKeys();
  if (!keys.length) throw new Error('CEREBRAS_API_KEY no configurado');
  for (const key of keys) {
    try {
      const resp = await axios.post(
        'https://api.cerebras.ai/v1/chat/completions',
        payload,
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 90000 }
      );
      return resp.data.choices[0].message.content.trim();
    } catch (e) {
      if (e.response?.status === 429) {
        console.log('[cerebras] key agotada, probando siguiente...');
        continue;
      }
      throw e;
    }
  }
  throw new Error('cerebras_rate_limit');
}

const MYMEMORY_LANG = { es: 'es', en: 'en', pt: 'pt', fr: 'fr', ru: 'ru' };

async function myMemoryTraducir(texto, idiomaDestino) {
  // Split into chunks of 490 chars (MyMemory limit is 500)
  const CHUNK = 490;
  const chunks = [];
  for (let i = 0; i < texto.length; i += CHUNK) chunks.push(texto.slice(i, i + CHUNK));

  const traducciones = await Promise.all(chunks.map(async (chunk) => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=auto|${MYMEMORY_LANG[idiomaDestino]}`;
    const resp = await axios.get(url, { timeout: 15000 });
    return resp.data?.responseData?.translatedText || chunk;
  }));
  return traducciones.join(' ');
}

async function traducirTexto(texto, idioma) {
  const payload = {
    model: 'llama-3.3-70b',
    messages: [
      { role: 'system', content: SISTEMAS[idioma] },
      { role: 'user', content: texto },
    ],
    temperature: 0.2,
    max_tokens: 4096,
  };

  // 1. Groq (key rotation)
  try {
    return await groqPost({ ...payload, model: 'llama-3.3-70b-versatile' }, 1);
  } catch {
    console.log('[traducir] Groq agotado, intentando Cerebras...');
  }

  // 2. Cerebras
  try {
    return await cerebrasPost(payload);
  } catch {
    console.log('[traducir] Cerebras falló, cayendo a MyMemory...');
  }

  // 3. MyMemory (sin IA, básico)
  return myMemoryTraducir(texto, idioma);
}

function resizeImgPath(imgPath) {
  const { execSync } = require('child_process');
  const tmpPath = `/tmp/crfl_${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    execSync(`convert "${imgPath}" -resize 800x -quality 50 "${tmpPath}"`, { timeout: 8000 });
    return tmpPath;
  } catch {
    return imgPath; // ImageMagick not available, use original
  }
}

async function groqVisionTraducir(imgPath, idioma) {
  if (!getGroqKeys().length) throw new Error('GROQ_API_KEY no configurado');
  const nombre = { es: 'español', en: 'English', pt: 'português', fr: 'français', ru: 'русский' }[idioma] || idioma;

  const resizedPath = resizeImgPath(imgPath);
  const imgBase64 = fs.readFileSync(resizedPath).toString('base64');
  if (resizedPath !== imgPath) { try { fs.unlinkSync(resizedPath); } catch {} }

  return groqPost({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Extrae TODO el texto de esta página de patrón de crochet y tradúcelo al ${nombre}. Mantén la estructura. Devuelve SOLO el texto traducido.` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
      ],
    }],
    temperature: 0.2,
    max_tokens: 1500,
  });
}

// Listar patrones (con info de preview gratis)
exports.listar = async (req, res) => {
  try {
    const { categoria, dificultad, search, destacado, tendencia, orden, limit, offset, offline } = req.query;
    const userId = req.userId || null;

    let sql = `
      SELECT
        p.*,
        CASE WHEN ml.patron_id IS NOT NULL THEN 1 ELSE 0 END as en_mi_lista,
        CASE WHEN pr.patron_id IS NOT NULL THEN 1 ELSE 0 END as en_progreso,
        CASE WHEN pr.descargado_offline = 1 THEN 1 ELSE 0 END as offline
      FROM patrones p
      LEFT JOIN mi_lista ml ON ml.patron_id = p.id AND ml.user_id = ?
      LEFT JOIN progreso pr ON pr.patron_id = p.id AND pr.user_id = ?
      WHERE p.activo = 1 AND p.paginas > 0
    `;
    const params = [userId, userId];

    if (categoria) { sql += ' AND p.categoria = ?'; params.push(categoria); }
    if (dificultad) { sql += ' AND p.dificultad = ?'; params.push(dificultad); }
    if (destacado === '1') { sql += ' AND p.destacado = 1'; }
    if (tendencia === '1') { sql += ' AND p.tendencia = 1'; }
    if (offline === '1') { sql += ' AND pr.descargado_offline = 1'; }
    if (search) {
      // Use CASE WHEN so that fields with placeholder values like "Telegram" are excluded from search
      sql += ` AND (
        p.titulo LIKE ?
        OR (CASE WHEN LOWER(p.autor) LIKE '%telegram%' OR LOWER(p.autor) IN ('autor','autora','diseñadora','desconocida','n/a','sin nombre','pdf','file') THEN NULL ELSE p.autor END) LIKE ?
        OR (CASE WHEN LOWER(p.diseñadora) LIKE '%telegram%' OR LOWER(p.diseñadora) IN ('autor','autora','diseñadora','desconocida','n/a','sin nombre','pdf','file') THEN NULL ELSE p.diseñadora END) LIKE ?
      )`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += orden === 'aleatorio' ? ' ORDER BY RANDOM()' : ' ORDER BY p.created_at DESC';

    const lim = parseInt(limit) || 60;
    const off = parseInt(offset) || 0;
    sql += ` LIMIT ${lim} OFFSET ${off}`;

    const BAD_VALUES = new Set(['telegram','autor','autora','diseñadora','desconocida','unknown','n/a','sin nombre','pdf','file']);
    const cleanField = (v) => {
      if (!v) return null;
      const lower = v.toLowerCase();
      if (lower.includes('telegram') || BAD_VALUES.has(lower)) return null;
      return v;
    };

    const [patrones, total] = await Promise.all([
      new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []).map(p => ({ ...p, autor: cleanField(p.autor), diseñadora: cleanField(p.diseñadora) })));
        });
      }),
      new Promise((resolve, reject) => {
        let countSql, countParams;
        if (offline === '1') {
          countSql = `SELECT COUNT(*) as n FROM patrones p LEFT JOIN progreso pr ON pr.patron_id = p.id AND pr.user_id = ? WHERE p.activo = 1 AND p.paginas > 0 AND pr.descargado_offline = 1`;
          countParams = [userId];
        } else {
          countSql = `SELECT COUNT(*) as n FROM patrones p WHERE p.activo = 1 AND p.paginas > 0`;
          countParams = [];
          if (categoria) { countSql += ' AND p.categoria = ?'; countParams.push(categoria); }
          if (dificultad) { countSql += ' AND p.dificultad = ?'; countParams.push(dificultad); }
          if (destacado === '1') { countSql += ' AND p.destacado = 1'; }
          if (tendencia === '1') { countSql += ' AND p.tendencia = 1'; }
          if (search) { countSql += ' AND p.titulo LIKE ?'; countParams.push(`%${search}%`); }
        }
        db.get(countSql, countParams, (err, row) => { if (err) reject(err); else resolve(row?.n || 0); });
      }),
    ]);

    res.json({ patrones, total });

  } catch (err) {
    console.error('Error listar patrones:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Detalle de un patrón
exports.detalle = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId || null;

    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM patrones WHERE id = ? AND activo = 1', [id], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!patron) {
      return res.status(404).json({ error: 'Patrón no encontrado' });
    }

    // Verificar si tiene acceso
    let tieneAcceso = false;
    let esPreview = false;
    let errorAcceso = null;

    if (patron.es_preview) {
      const mesActual = new Date().toISOString().slice(0, 7);
      const previewUsado = await new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM preview_mensual WHERE user_id = ? AND mes_anio = ?',
          [userId, mesActual],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });
      if (!previewUsado || previewUsado.patron_id === id) {
        tieneAcceso = true; esPreview = true;
      }
    }

    // Verificar suscripción activa
    let user = null;
    if (!tieneAcceso && userId) {
      user = await new Promise((resolve, reject) => {
        db.get('SELECT tier, subscription_expires_at FROM users WHERE id = ?',
          [userId], (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) > new Date()) {
        tieneAcceso = true;
      }
    }

    // Progreso del usuario (fetch early — needed for free-limit check)
    const progresoRaw = await new Promise((resolve, reject) => {
      db.get(
        'SELECT pagina_actual, completado, descargado_offline FROM progreso WHERE user_id = ? AND patron_id = ?',
        [userId, id],
        (err, row) => { if (err) reject(err); else resolve(row || null); }
      );
    });
    const progreso = progresoRaw || { pagina_actual: 1, completado: 0, descargado_offline: 0 };

    // Contar patrones abiertos por usuario free
    let patronesUsados = 0;
    if (!tieneAcceso && userId) {
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as n FROM progreso WHERE user_id = ?',
          [userId], (err, r) => { if (err) reject(err); else resolve(r); });
      });
      patronesUsados = row?.n || 0;
      // Grant access if under 1-pattern limit OR if user already started this pattern
      if (patronesUsados < 1 || progresoRaw !== null) {
        tieneAcceso = true;
      } else {
        errorAcceso = 'limite_free';
      }
    } else if (!tieneAcceso) {
      errorAcceso = 'sin_registro';
    }

    res.json({
      patron,
      tieneAcceso,
      esPreview,
      errorAcceso,
      patronesUsados,
      progreso
    });

  } catch (err) {
    console.error('Error detalle patron:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Toggle Mi Lista
exports.toggleMiLista = async (req, res) => {
  try {
    const { patronId } = req.body;
    const userId = req.userId;

    const existe = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM mi_lista WHERE user_id = ? AND patron_id = ?',
        [userId, patronId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (existe) {
      await new Promise((resolve, reject) => {
        db.run(
          'DELETE FROM mi_lista WHERE user_id = ? AND patron_id = ?',
          [userId, patronId],
          function(err) {
            if (err) reject(err);
            resolve();
          }
        );
      });
      res.json({ agregado: false });
    } else {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO mi_lista (user_id, patron_id) VALUES (?, ?)',
          [userId, patronId],
          function(err) {
            if (err) reject(err);
            resolve();
          }
        );
      });
      res.json({ agregado: true });
    }

  } catch (err) {
    console.error('Error toggle mi lista:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Traducir página de patrón
exports.traducir = async (req, res) => {
  try {
    const { id } = req.params;
    const { idioma, pagina } = req.body;
    const userId = req.userId;

    const IDIOMAS_VALIDOS = ['es', 'en', 'pt', 'ru', 'fr'];
    if (!IDIOMAS_VALIDOS.includes(idioma)) return res.status(400).json({ error: 'Idioma no soportado' });
    const paginaNum = parseInt(pagina) || 1;

    const patron = await dbGet('SELECT id, idioma FROM patrones WHERE id = ? AND activo = 1', [id]);
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });

    // Caché: devolver sin contar límite si ya existe
    const cached = await dbGet(
      'SELECT texto_traducido FROM traducciones_paginas WHERE patron_id = ? AND pagina = ? AND idioma = ?',
      [id, paginaNum, idioma]
    );
    if (cached) return res.json({ texto: cached.texto_traducido, cached: true });

    // Control semanal (lunes a domingo) — omitir para usuarios sin límite
    const userRow = await dbGet('SELECT email FROM users WHERE id = ?', [userId]);
    if (!SIN_LIMITE_TRADUCCION.has(userRow?.email)) {
      const hoy = new Date();
      const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - diaSemana);
      const semana = lunes.toISOString().slice(0, 10);

      const LIMITE = 5;
      const yaUsado = await dbGet(
        'SELECT 1 FROM traducciones_uso WHERE user_id = ? AND patron_id = ? AND semana = ?',
        [userId, id, semana]
      );
      if (!yaUsado) {
        const usados = await dbGet(
          'SELECT COUNT(DISTINCT patron_id) as n FROM traducciones_uso WHERE user_id = ? AND semana = ?',
          [userId, semana]
        );
        if ((usados?.n || 0) >= LIMITE) {
          return res.status(403).json({
            error: 'limite_traduccion',
            mensaje: `Alcanzaste el límite de ${LIMITE} patrones traducidos esta semana. Se renueva el lunes.`,
          });
        }
        await dbRun(
          'INSERT OR IGNORE INTO traducciones_uso (user_id, patron_id, semana) VALUES (?, ?, ?)',
          [userId, id, semana]
        );
      }
    }

    let traduccion = null;
    const patronDir = path.join(UPLOADS_DIR, id);

    // 1. Intentar pdftotext primero — rápido (<1s) para PDFs con capa de texto
    if (fs.existsSync(patronDir)) {
      const pdf = fs.readdirSync(patronDir).find(f => f.endsWith('.pdf'));
      if (pdf) {
        try {
          const { execSync } = require('child_process');
          const texto = execSync(
            `pdftotext -f ${paginaNum} -l ${paginaNum} "${path.join(patronDir, pdf)}" -`,
            { timeout: 12000 }
          ).toString().trim();
          if (texto && texto.length > 20) {
            traduccion = await traducirTexto(texto, idioma);
          }
        } catch {}
      }
    }

    // 2. Fallback: visión con la imagen ya convertida (PDFs basados en imagen)
    if (!traduccion) {
      const posibles = [
        path.join(UPLOADS_DIR, id, `pagina_${paginaNum}.jpg`),
        path.join(UPLOADS_DIR, id, `pagina.${paginaNum}.jpeg`),
        path.join(UPLOADS_DIR, id, `pagina.${paginaNum}.jpg`),
        path.join(UPLOADS_DIR, id, `pagina_${paginaNum}.jpeg`),
      ];
      const imgPath = posibles.find(p => fs.existsSync(p));
      if (imgPath) {
        traduccion = await groqVisionTraducir(imgPath, idioma);
      }
    }

    if (!traduccion) return res.status(400).json({ error: 'No se pudo obtener el texto de esta página' });

    const newId = crypto.randomBytes(8).toString('hex');
    await dbRun(
      'INSERT OR REPLACE INTO traducciones_paginas (id, patron_id, pagina, idioma, texto_traducido) VALUES (?, ?, ?, ?, ?)',
      [newId, id, paginaNum, idioma, traduccion]
    );

    res.json({ texto: traduccion, cached: false });

  } catch (err) {
    console.error('[traduccion]', err.message);
    if (err.message === 'rate_limit') {
      return res.status(503).json({ error: 'Servicio ocupado. Intenta en 1 minuto.' });
    }
    res.status(500).json({ error: 'No se pudo traducir' });
  }
};