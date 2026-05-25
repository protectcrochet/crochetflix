const db = require('../models');

// Listar patrones (con info de preview gratis)
exports.listar = async (req, res) => {
  try {
    const { categoria, dificultad, search } = req.query;
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

    sql += ' ORDER BY p.created_at DESC';

    // Paginación
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 24));

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

    // Verificar si tiene acceso
    let tieneAcceso = false;
    let esPreview = false;

    if (patron.es_preview) {
      // Verificar si ya usó su preview mensual
      const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
      const previewUsado = await new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM preview_mensual WHERE user_id = ? AND mes_anio = ?',
          [userId, mesActual],
          (err, row) => {
            if (err) reject(err);
            resolve(row);
          }
        );
      });

      if (!previewUsado || previewUsado.patron_id === id) {
        tieneAcceso = true;
        esPreview = true;
      }
    }

    // Acceso libre para usuarios registrados (temporalmente sin suscripción requerida)
    if (!tieneAcceso && userId) {
      tieneAcceso = true;
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
      esPreview,
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