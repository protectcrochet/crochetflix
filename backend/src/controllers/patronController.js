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
    const SYSTEM = {
      es: `Eres un traductor profesional de patrones de crochet al español mexicano.

REGLAS:
1. Traduce TODO el texto al español. Ninguna palabra puede quedar en otro idioma.
2. Abreviaturas oficiales México: sc→pb, dc→pa, hdc→mpa, tr→pad, dtr→patr, sl st→pd, ch→cad, inc→aum, dec→dism, sc2tog→pb2jun, BLO→hta, FLO→hte, MR→anillo mágico, yo→hp, rnd→vta, rep→rep, sts→p (solo en conteos entre paréntesis).
3. IMPORTANTE: "pb" es la instrucción de tejido. "p" solo aparece en conteos finales entre paréntesis: (54 sts)→(54p).
4. Conserva el formato exacto: saltos de línea, numeración de vueltas, paréntesis con conteos.
5. Responde ÚNICAMENTE con el texto traducido.`,

      en: `You are a professional crochet pattern translator to English.

RULES:
1. Translate EVERYTHING to English. No Spanish (or any other language) words allowed in the output.
2. US crochet abbreviations: pb→sc, pa→dc, mpa→hdc, pad→tr, patr→dtr, pd→sl st, cad→ch, aum→inc, dism→dec, pb2jun→sc2tog, hta→BLO, hte→FLO, anillo mágico→MR (magic ring), hp→yo, vta→rnd, rep→rep, p→sts (in stitch counts only).
3. Stitch counts: (54p)→(54 sts).
4. Preserve exact format: line breaks, round numbering, parentheses with counts.
5. Reply ONLY with the translated text. No explanations, no comments.`,

      pt: `Você é um tradutor profissional de padrões de crochê para o português brasileiro.

REGRAS:
1. Traduza TUDO para o português. Nenhuma palavra pode ficar em espanhol ou outro idioma.
2. Abreviações brasileiras: pb→pb, pa→pa, mpa→mp, pad→ptr, pd→pp, cad→cad, aum→aum, dism→dim, MR→AM (argola mágica), vta→v (volta), rnd→v, rep→rep, sts→pts.
3. Conserve o formato exato: quebras de linha, numeração de voltas, contagens entre parênteses.
4. Responda APENAS com o texto traduzido.`,

      fr: `Vous êtes un traducteur professionnel de patrons de crochet en français.

RÈGLES :
1. Traduisez TOUT en français. Aucun mot espagnol (ou autre langue) dans la réponse.
2. Abréviations françaises (système UK) : pb→ms, pa→br, mpa→db, pad→br2, pd→mc, cad→ml, aum→aug, dism→dim, MR→AM (anneau magique), vta→rg (rang), rnd→rg, rep→rép, sts→m.
3. Conservez le format exact : sauts de ligne, numérotation des rangs, comptages entre parenthèses.
4. Répondez UNIQUEMENT avec le texte traduit.`,

      ru: `Вы — профессиональный переводчик схем вязания крючком на русский язык.

ПРАВИЛА:
1. Переведите ВСЁ на русский. Ни одного испанского слова в ответе.
2. Российские сокращения: pb→сбн, pa→стн, mpa→ппн, pad→с2н, pd→сс, cad→вп, aum→пр, dism→уб, MR→КА (кольцо амигуруми), vta→ряд, rnd→ряд, rep→повт., sts→п.
3. Сохраняйте точный формат: переносы строк, нумерацию рядов, подсчёты в скобках.
4. Отвечайте ТОЛЬКО переведённым текстом.`
    };

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM[idioma] },
        { role: 'user', content: textoOriginal }
      ],
      max_tokens: 4096,
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