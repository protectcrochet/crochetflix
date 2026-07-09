const db = require('../models');

// Listar patrones (con info de preview gratis)
exports.listar = async (req, res) => {
  try {
    const { categoria, dificultad, search, destacado, tendencia, orden, limit } = req.query;
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

    const lim = parseInt(limit) || 0;
    if (lim > 0) sql += ` LIMIT ${lim}`;

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
        db.get(`SELECT COUNT(*) as n FROM patrones WHERE activo = 1 AND paginas > 0`, [],
          (err, row) => { if (err) reject(err); else resolve(row?.n || 0); });
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