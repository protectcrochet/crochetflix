const db = require('../models');
const crypto = require('crypto');

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

    const patron = await dbGet('SELECT titulo, texto_pdf, idioma FROM patrones WHERE id = ? AND activo = 1', [id]);
    if (!patron) return res.status(404).json({ error: 'Patrón no encontrado' });

    if (patron.idioma === idioma) {
      return res.json({ texto: patron.texto_pdf || '', cached: true, mismoIdioma: true });
    }

    const cached = await dbGet('SELECT texto_traducido FROM traducciones WHERE patron_id = ? AND idioma = ?', [id, idioma]);
    if (cached) return res.json({ texto: cached.texto_traducido, cached: true });

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'Servicio de traducción no disponible' });
    }

    const textoOriginal = (patron.texto_pdf || '').slice(0, 3000);
    if (!textoOriginal.trim()) {
      return res.status(400).json({ error: 'Este patrón no tiene texto disponible para traducir' });
    }

    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const NOMBRES = { es: 'español', en: 'inglés', pt: 'portugués', ru: 'ruso', fr: 'francés' };

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Traduce el siguiente texto de un patrón de crochet al ${NOMBRES[idioma]}. Mantén los términos técnicos de crochet correctos en el idioma destino. Solo devuelve el texto traducido, sin explicaciones ni comentarios.\n\n${textoOriginal}`
      }],
      max_tokens: 2000,
    });

    const traduccion = completion.choices[0].message.content.trim();
    const newId = crypto.randomBytes(8).toString('hex');
    await dbRun('INSERT OR REPLACE INTO traducciones (id, patron_id, idioma, texto_traducido) VALUES (?, ?, ?, ?)',
      [newId, id, idioma, traduccion]);

    res.json({ texto: traduccion, cached: false });

  } catch (err) {
    console.error('Error traduciendo patrón:', err);
    res.status(500).json({ error: 'Error al traducir' });
  }
};