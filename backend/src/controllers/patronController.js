const db = require('../models');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, exec } = require('child_process');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');

function localizarPDF(patronId) {
  const patronDir = path.join(UPLOADS_DIR, patronId);
  if (fs.existsSync(patronDir)) {
    const pdf = fs.readdirSync(patronDir).find(f => f.endsWith('.pdf'));
    if (pdf) return path.join(patronDir, pdf);
  }
  const shortId = patronId.replace('patron-', '');
  const flat = fs.readdirSync(UPLOADS_DIR).find(f => f.startsWith(shortId) && f.endsWith('.pdf'));
  return flat ? path.join(UPLOADS_DIR, flat) : null;
}

const TESSERACT_LANG = { es: 'spa', en: 'eng', pt: 'por', fr: 'fra', ru: 'rus' };

function runAsync(cmd, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    exec(cmd, (err, stdout) => {
      clearTimeout(timer);
      if (err) reject(err); else resolve(stdout);
    });
  });
}

async function extraerTextoPaginaOCR(pdfPath, pagina, idiomaPatron) {
  const tmpId = crypto.randomBytes(6).toString('hex');
  const tmpImg = path.join(os.tmpdir(), `crfl_${tmpId}`);
  const ocrLang = TESSERACT_LANG[idiomaPatron] || 'spa+eng';
  try {
    await runAsync(`pdftoppm -f ${pagina} -l ${pagina} -r 150 "${pdfPath}" "${tmpImg}"`, 25000);
    const imgs = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`crfl_${tmpId}`) && !f.endsWith('_out.txt'));
    if (!imgs.length) return '';
    const imgPath = path.join(os.tmpdir(), imgs[0]);
    await runAsync(`tesseract "${imgPath}" "${tmpImg}_out" -l ${ocrLang} --oem 3 --psm 6`, 45000);
    const texto = fs.readFileSync(`${tmpImg}_out.txt`, 'utf8').trim();
    try { fs.unlinkSync(imgPath); } catch {}
    try { fs.unlinkSync(`${tmpImg}_out.txt`); } catch {}
    return texto;
  } catch {
    try { fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`crfl_${tmpId}`)).forEach(f => { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {} }); } catch {}
    return '';
  }
}

async function extraerTextoPagina(patronId, pagina, idiomaPatron) {
  try {
    const pdfPath = localizarPDF(patronId);
    if (!pdfPath) return '';
    const texto = execSync(`pdftotext -f ${pagina} -l ${pagina} "${pdfPath}" -`, { timeout: 15000 }).toString().trim();
    if (texto) return texto;
    // PDF has no text layer (image-based) — try OCR without blocking event loop
    return await extraerTextoPaginaOCR(pdfPath, pagina, idiomaPatron);
  } catch {
    return '';
  }
}

const dbGet = (sql, params) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

// Listar patrones (con info de preview gratis)
exports.listar = async (req, res) => {
  try {
    const { categoria, dificultad, search, destacado } = req.query;
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
      WHERE p.activo = 1
    `;
    const params = [userId, userId];

    if (categoria) {
      sql += ' AND p.categoria = ?';
      params.push(categoria);
    }
    if (dificultad) {
      sql += ' AND p.dificultad = ?';
      params.push(dificultad);
    }
    if (search) {
      sql += ' AND (p.titulo LIKE ? OR p.autor LIKE ? OR p.diseñadora LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (destacado === '1') {
      sql += ' AND p.destacado = 1';
    }
    if (req.query.tendencia === '1') {
      sql += ' AND p.tendencia = 1';
    }
    if (req.query.idioma) {
      sql += ' AND p.idioma = ?';
      params.push(req.query.idioma);
    }
    if (req.query.mi_lista === '1') {
      sql += ' AND ml.patron_id IS NOT NULL';
    }
    if (req.query.offline === '1') {
      sql += ' AND pr.descargado_offline = 1';
    }

    switch (req.query.orden) {
      case 'az': sql += ' ORDER BY p.titulo ASC'; break;
      case 'paginas': sql += ' ORDER BY p.paginas DESC'; break;
      case 'aleatorio': sql += ' ORDER BY RANDOM()'; break;
      default: sql += ' ORDER BY p.created_at DESC';
    }

    // Paginación
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 24));

    const total = await new Promise((resolve, reject) => {
      const countSql = sql.replace(
        /SELECT[\s\S]*?FROM patrones p/,
        'SELECT COUNT(*) as total FROM patrones p'
      ).split('ORDER BY')[0];
      db.get(countSql, params, (err, row) => {
        if (err) reject(err); else resolve(row?.total || 0);
      });
    });

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);

    const patrones = await new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        resolve(rows);
      });
    });

    res.json({ patrones, total, page, limit, totalPaginas: Math.ceil(total / limit) });

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

    // ── Lógica de acceso ────────────────────────────────────────────────────
    let tieneAcceso = false;
    let errorAcceso = null;
    let patronesUsados = 0;

    if (!userId) {
      tieneAcceso = false;
      errorAcceso = 'sin_registro';
    } else if (req.userTier === 'premium') {
      tieneAcceso = true;
    } else {
      // Free: 3 pruebas únicas, luego 1 patrón nuevo por mes
      const yaAccedido = await new Promise(r =>
        db.get('SELECT 1 FROM progreso WHERE user_id = ? AND patron_id = ?', [userId, id], (_, row) => r(row))
      );
      if (yaAccedido) {
        tieneAcceso = true;
      } else {
        patronesUsados = await new Promise(r =>
          db.get('SELECT COUNT(DISTINCT patron_id) as n FROM progreso WHERE user_id = ?', [userId], (_, row) => r(row?.n || 0))
        );
        if (patronesUsados < 3) {
          tieneAcceso = true;
        } else {
          const patronesMes = await new Promise(r =>
            db.get(
              `SELECT COUNT(DISTINCT patron_id) as n FROM progreso
               WHERE user_id = ? AND strftime('%Y-%m', COALESCE(primer_acceso, ultimo_acceso)) = strftime('%Y-%m', 'now')`,
              [userId], (_, row) => r(row?.n || 0)
            )
          );
          if (patronesMes < 1) {
            tieneAcceso = true;
          } else {
            tieneAcceso = false;
            errorAcceso = 'limite_free';
          }
        }
      }
    }

    // Progreso del usuario
    const progreso = await new Promise((resolve, reject) => {
      db.get(
        'SELECT pagina_actual, completado, descargado_offline FROM progreso WHERE user_id = ? AND patron_id = ?',
        [userId, id],
        (err, row) => {
          if (err) reject(err);
          resolve(row || { pagina_actual: 1, completado: 0, descargado_offline: 0 });
        }
      );
    });

    res.json({
      patron,
      tieneAcceso,
      errorAcceso,
      patronesUsados,
      esPreview: false,
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
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
      res.json({ agregado: false });
    } else {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT OR IGNORE INTO mi_lista (user_id, patron_id) VALUES (?, ?)',
          [userId, patronId],
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
      res.json({ agregado: true });
    }

  } catch (err) {
    console.error('Error toggle mi lista:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Traducir patrón (solo premium, con caché)
exports.traducir = async (req, res) => {
  try {
    const { id } = req.params;
    const { idioma } = req.body;

    const userRow = await dbGet('SELECT tier, subscription_expires_at FROM users WHERE id = ?', [req.userId]);
    const isPremium = userRow?.tier === 'premium' &&
      (!userRow.subscription_expires_at || new Date(userRow.subscription_expires_at) > new Date());
    if (!isPremium) {
      return res.status(403).json({ error: 'Solo disponible para usuarios premium' });
    }

    const IDIOMAS_VALIDOS = ['es', 'en', 'pt', 'ru', 'fr'];
    if (!IDIOMAS_VALIDOS.includes(idioma)) {
      return res.status(400).json({ error: 'Idioma no soportado' });
    }

    const pagina = parseInt(req.body.pagina) || 1;

    const patron = await dbGet('SELECT titulo, idioma FROM patrones WHERE id = ? AND activo = 1', [id]);
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });

    // Caché: si ya existe esta página traducida, devolver sin contar límite
    const cached = await dbGet(
      'SELECT texto_traducido FROM traducciones_paginas WHERE patron_id = ? AND pagina = ? AND idioma = ?',
      [id, pagina, idioma]
    );
    if (cached) return res.json({ texto: cached.texto_traducido, cached: true });

    // Límite semanal: 5 patrones distintos por semana
    const LIMITE = 5;
    const semana = new Date().toISOString().slice(0, 10).replace(/-\d\d$/, '') +
      '-W' + String(Math.ceil(new Date().getDate() / 7)).padStart(2, '0');

    // ¿Ya tradujo páginas de este patrón esta semana? → no cuenta como nuevo patrón
    const yaUsado = await dbGet(
      'SELECT 1 FROM traducciones_uso WHERE user_id = ? AND patron_id = ? AND semana = ?',
      [req.userId, id, semana]
    );

    if (!yaUsado) {
      const usados = await dbGet(
        'SELECT COUNT(DISTINCT patron_id) as n FROM traducciones_uso WHERE user_id = ? AND semana = ?',
        [req.userId, semana]
      );
      if ((usados?.n || 0) >= LIMITE) {
        return res.status(403).json({
          error: 'limite_traduccion',
          mensaje: `Alcanzaste el límite de ${LIMITE} patrones traducidos esta semana. Se renueva el lunes.`,
          usados: usados?.n || 0,
          limite: LIMITE
        });
      }
      // Registrar uso
      await dbRun(
        'INSERT OR IGNORE INTO traducciones_uso (user_id, patron_id, semana) VALUES (?, ?, ?)',
        [req.userId, id, semana]
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'Servicio de traducción no disponible' });
    }

    const textoOriginal = await extraerTextoPagina(id, pagina, patron.idioma || 'es');
    if (!textoOriginal) {
      return res.status(400).json({ error: 'Esta página no tiene texto para traducir' });
    }

    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const GUIA = {
      es: `Traduce al ESPAÑOL MEXICANO. Convierte TODAS las abreviaturas al estándar mexicano:

sc / single crochet → pb
dc / double crochet → pa
hdc / half double crochet → mpa
tr / treble crochet → pad
dtr / double treble → patr
sl st / slip stitch → pd
ch / chain → cad
inc / increase → aum
dec / decrease → dism
sc2tog → pb2jun
dc2tog → pa2jun
BLO / back loop only → hta
FLO / front loop only → hte
magic ring / MR / magic circle → anillo mágico
yo / yarn over → hp
sp / space → esp
RS / right side → LD
WS / wrong side → LR
rnd / round / row → vta
rep / repeat → rep
sts / stitches (conteo) → p  ← SOLO en conteos entre paréntesis, ej: (54 sts)→(54p)

CRÍTICO: "pb" es la instrucción de tejido (acción). "p" SOLO para conteos finales entre paréntesis. NUNCA escribas "p" sola como instrucción.`,

      en: `Translate to ENGLISH (US crochet terms). Convert ALL abbreviations to US standard:

pb (punto bajo) → sc
pa (punto alto) → dc
mpa (medio punto alto) → hdc
pad (punto alto doble) → tr
patr (punto alto triple) → dtr
pd (punto deslizado) → sl st
cad (cadena) → ch
aum (aumento) → inc
dism (disminución) → dec
pb2jun → sc2tog
pa2jun → dc2tog
hta (hebra trasera) → BLO
hte (hebra delantera) → FLO
anillo mágico / am → MR (magic ring)
hp (hebra sobre aguja) → yo
esp (espacio) → sp
LD → RS (right side)
LR → WS (wrong side)
vta / vuelta → rnd
rep → rep
pts / p (conteo) → sts  ← only in stitch counts in parentheses, e.g. (54p)→(54 sts)

If the source already uses English abbreviations (sc, dc, inc, etc.), keep them. Only translate Spanish words and abbreviations.`,

      pt: `Traduz para o PORTUGUÊS BRASILEIRO. Converte TODAS as abreviações para o padrão brasileiro:

sc / pb → pb (ponto baixo)
dc / pa → pa (ponto alto)
hdc / mpa → mp (meio ponto)
tr / pad → ptr (ponto triplo)
dtr / patr → pdt (ponto duplo triplo)
sl st / pd → pp (ponto preso)
ch / cad → cad (corrente)
inc / aum → aum (aumento)
dec / dism → dim (diminuição)
sc2tog / pb2jun → 2pbj (2 pontos baixos juntos)
BLO / hta → ALT (alça de trás)
FLO / hte → ALD (alça da frente)
magic ring / anillo mágico / MR → AM (argola mágica)
yo / hp → lp (laçada sobre o gancho)
rnd / vta → v (volta)
rep → rep
sts / pts → pts (pontos)`,

      fr: `Traduis en FRANÇAIS. Convertis TOUTES les abréviations au standard français (système UK) :

sc / pb → ms (maille serrée)
dc / pa → br (bride)
hdc / mpa → db (demi-bride)
tr / pad → br2 (bride double)
dtr / patr → br3 (bride triple)
sl st / pd → mc (maille coulée)
ch / cad → ml (maille en l'air)
inc / aum → aug (augmentation)
dec / dism → dim (diminution)
sc2tog / pb2jun → 2ms ens. (2 mailles serrées ensemble)
BLO / hta → BRD (brin du dos)
FLO / hte → BRE (brin de l'endroit)
magic ring / anillo mágico / MR → AM (anneau magique)
yo / hp → jf (jeté de fil)
rnd / vta → rg (rang/tour)
rep → rép
sts / pts → m (mailles)`,

      ru: `Переводи на РУССКИЙ ЯЗЫК. Конвертируй ВСЕ сокращения в российский стандарт:

sc / pb → сбн (столбик без накида)
dc / pa → стн (столбик с накидом)
hdc / mpa → ппн (полустолбик с накидом)
tr / pad → с2н (столбик с 2 накидами)
dtr / patr → с3н (столбик с 3 накидами)
sl st / pd → сс (соединительный столбик)
ch / cad → вп (воздушная петля)
inc / aum → пр (прибавка)
dec / dism → уб (убавка)
sc2tog / pb2jun → 2сбн вместе
BLO / hta → за заднюю стенку (з.ст.)
FLO / hte → за переднюю стенку (п.ст.)
magic ring / anillo mágico / MR → КА (кольцо амигуруми)
yo / hp → накид
rnd / vta → ряд (or кр — круг, для кругового вязания)
rep → повт.
sts / pts → п (петли)`
    };

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `${GUIA[idioma]}

Conserva EXACTAMENTE el mismo formato del original: mismos saltos de línea, misma numeración de vueltas, mismos paréntesis con conteos. Devuelve SOLO el texto traducido, sin explicaciones ni comentarios.

Texto:
${textoOriginal}`
      }],
      max_tokens: 1500,
    });

    const traduccion = completion.choices[0].message.content.trim();
    const newId = crypto.randomBytes(8).toString('hex');
    await dbRun(
      'INSERT OR REPLACE INTO traducciones_paginas (id, patron_id, pagina, idioma, texto_traducido) VALUES (?, ?, ?, ?, ?)',
      [newId, id, pagina, idioma, traduccion]
    );

    res.json({ texto: traduccion, cached: false });

  } catch (err) {
    console.error('Error traduciendo patrón:', err);
    res.status(500).json({ error: 'Error al traducir' });
  }
};