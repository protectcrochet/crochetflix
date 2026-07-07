const db = require('../models');
const path = require('path');
const fs = require('fs');

// Entregar página de patrón (blob, no URL directa)
exports.getPagina = async (req, res) => {
  try {
    const { patronId, paginaNum } = req.params;
    const userId = req.userId;

    // Verificar acceso del usuario
    const patron = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM patrones WHERE id = ? AND activo = 1', [patronId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!patron) {
      return res.status(404).json({ error: 'Patrón no encontrado' });
    }

    let tieneAcceso = false;

    // Bloquear patrones solo-premium para usuarios no premium
    if (patron.es_solo_premium) {
      const user = await new Promise((resolve, reject) => {
        db.get('SELECT tier, subscription_expires_at FROM users WHERE id = ?', [userId], (err, row) => {
          if (err) reject(err);
          resolve(row);
        });
      });
      if (!user || user.tier !== 'premium' || new Date(user.subscription_expires_at) <= new Date()) {
        return res.status(402).json({ error: 'solo_premium' });
      }
    }

    // Verificar preview mensual
    if (patron.es_preview) {
      const mesActual = new Date().toISOString().slice(0, 7);
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

      if (!previewUsado) {
        // Registrar uso de preview
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO preview_mensual (user_id, patron_id, mes_anio) VALUES (?, ?, ?)',
            [userId, patronId, mesActual],
            function(err) {
              if (err) reject(err);
              resolve();
            }
          );
        });
        tieneAcceso = true;
      } else if (previewUsado.patron_id === patronId) {
        tieneAcceso = true;
      }
    }

    // Verificar suscripción premium
    if (!tieneAcceso) {
      const user = await new Promise((resolve, reject) => {
        db.get(
          'SELECT tier, subscription_expires_at FROM users WHERE id = ?',
          [userId],
          (err, row) => {
            if (err) reject(err);
            resolve(row);
          }
        );
      });

      if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) > new Date()) {
        tieneAcceso = true;
      }
    }

    if (!tieneAcceso) {
      return res.status(403).json({ error: 'Acceso denegado. Suscríbete para ver este patrón.' });
    }

    // Buscar archivo de página
    const pagina = await new Promise((resolve, reject) => {
      db.get(
        'SELECT archivo_path FROM paginas WHERE patron_id = ? AND numero = ?',
        [patronId, paginaNum],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!pagina) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const filePath = path.join(__dirname, '../../uploads', pagina.archivo_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Actualizar progreso
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO progreso (user_id, patron_id, pagina_actual, ultimo_acceso)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, patron_id) DO UPDATE SET
         pagina_actual = excluded.pagina_actual,
         ultimo_acceso = CURRENT_TIMESTAMP`,
        [userId, patronId, paginaNum],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Enviar como blob con headers anti-caching
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

  } catch (err) {
    console.error('Error getPagina:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Guardar progreso manualmente
exports.guardarProgreso = async (req, res) => {
  try {
    const { patronId, paginaActual } = req.body;
    const userId = req.userId;

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO progreso (user_id, patron_id, pagina_actual, ultimo_acceso)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, patron_id) DO UPDATE SET
         pagina_actual = excluded.pagina_actual,
         ultimo_acceso = CURRENT_TIMESTAMP`,
        [userId, patronId, paginaActual],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    res.json({ message: 'Progreso guardado' });

  } catch (err) {
    console.error('Error guardar progreso:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Marcar como completado
exports.completar = async (req, res) => {
  try {
    const { patronId } = req.body;
    const userId = req.userId;

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE progreso SET completado = 1 WHERE user_id = ? AND patron_id = ?`,
        [userId, patronId],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    res.json({ message: 'Patrón completado' });

  } catch (err) {
    console.error('Error completar:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Toggle descarga offline
exports.toggleOffline = async (req, res) => {
  try {
    const { patronId } = req.body;
    const userId = req.userId;

    // Verificar límite de 5 patrones offline
    const offlineCount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as count FROM progreso WHERE user_id = ? AND descargado_offline = 1',
        [userId],
        (err, row) => {
          if (err) reject(err);
          resolve(row.count);
        }
      );
    });

    const actual = await new Promise((resolve, reject) => {
      db.get(
        'SELECT descargado_offline FROM progreso WHERE user_id = ? AND patron_id = ?',
        [userId, patronId],
        (err, row) => {
          if (err) reject(err);
          resolve(row ? row.descargado_offline : 0);
        }
      );
    });

    if (!actual && offlineCount >= 5) {
      return res.status(400).json({ error: 'Límite de 5 patrones offline alcanzado' });
    }

    const nuevoValor = actual ? 0 : 1;

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO progreso (user_id, patron_id, descargado_offline)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, patron_id) DO UPDATE SET
         descargado_offline = excluded.descargado_offline`,
        [userId, patronId, nuevoValor],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    res.json({ descargado: nuevoValor === 1 });

  } catch (err) {
    console.error('Error toggle offline:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};