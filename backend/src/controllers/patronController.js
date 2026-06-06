const db = require('../models');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

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

function extraerTextoPagina(patronId, pagina) {
  try {
    const pdfPath = localizarPDF(patronId);
    if (!pdfPath) return '';
    return execSync(`pdftotext -f ${pagina} -l ${pagina} "${pdfPath}" -`, { timeout: 15000 }).toString().trim();
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

    const patron = await dbGet('SELECT titulo FROM patrones WHERE id = ? AND activo = 1', [id]);
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

    const textoOriginal = extraerTextoPagina(id, pagina);
    if (!textoOriginal) {
      return res.status(400).json({ error: 'Esta página no tiene texto para traducir' });
    }

    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const NOMBRES = { es: 'español mexicano', en: 'inglés', pt: 'portugués', ru: 'ruso', fr: 'francés' };

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Traduce el siguiente texto de una página de patrón de crochet al ${NOMBRES[idioma]}. Conserva el formato y la numeración. Solo devuelve el texto traducido, sin explicaciones.

Usa SIEMPRE las abreviaturas oficiales de crochet en ${NOMBRES[idioma]}:
${idioma === 'es' ? `sc→pb (punto bajo), dc→pa (punto alto), hdc→mpa (medio punto alto), tr→pad (punto alto doble), dtr→patr (punto alto triple), sl st→pd (punto deslizado), ch→cad (cadeneta), inc→aum (aumento), dec→dism (disminución), sc2tog→pb2jun, dc2tog→pa2jun, BLO→hta (hebra trasera), FLO→hte (hebra delantera), MR→am (anillo mágico), rnd→vta (vuelta), rep→rep (repetir), st→p (punto), sp→esp (espacio), yo→hp (hebra sobre el gancho), magic ring→anillo mágico, RS→LD (lado derecho), WS→LR (lado revés)` :
  idioma === 'en' ? `pb→sc, pa→dc, mp→hdc, ptr→tr, pd→sl st, cad→ch, aum→inc, dism→dec, hta→BLO, hte→FLO, am→MR, vta→rnd` :
  idioma === 'pt' ? `sc→pb, dc→pa, hdc→mpp, tr→tpp, sl st→corr, ch→cad, inc→aum, dec→dim, rnd→vol, st→p` :
  idioma === 'fr' ? `sc→ms, dc→bs, hdc→demi-bs, tr→bs long, sl st→mc, ch→ml, inc→aug, dec→dim, rnd→rg, st→m` :
  idioma === 'ru' ? `sc→сбн, dc→стн, hdc→ссн, tr→стн с накидом, sl st→сс, ch→вп, inc→прибавка, dec→убавка, rnd→ряд` : ''}

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