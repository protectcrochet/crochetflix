const db = require('../models');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const geoip = require('geoip-lite');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/patrones');

function registrarVisita(patronId, userId, userTier, req) {
  // Solo contar una visita por usuario+patrón por día calendario
  const hoy = new Date().toISOString().slice(0, 10);
  db.get(
    `SELECT 1 FROM visitas WHERE user_id = ? AND patron_id = ? AND date(created_at) = ?`,
    [userId, patronId, hoy],
    (_, row) => {
      if (row) return; // ya visitó hoy
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      const geo = ip ? geoip.lookup(ip) : null;
      const pais = geo?.country || null;
      db.run(
        'INSERT INTO visitas (id, patron_id, user_id, user_tier, ip, pais) VALUES (?,?,?,?,?,?)',
        [crypto.randomUUID(), patronId, userId, userTier, ip, pais]
      );
    }
  );
}

function convertirPDFLazy(patronId) {
  const outDir = path.join(UPLOADS_DIR, patronId);
  fs.mkdirSync(outDir, { recursive: true });

  // Buscar PDF: en subdirectorio propio o en formato plano del bot
  let pdfPath = null;
  const subFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  const pdfSub = subFiles.find(f => f.endsWith('.pdf'));
  if (pdfSub) {
    pdfPath = path.join(outDir, pdfSub);
  } else {
    const shortId = patronId.replace('patron-', '');
    const flatFiles = fs.readdirSync(UPLOADS_DIR);
    const pdfFlat = flatFiles.find(f => f.startsWith(shortId) && f.endsWith('.pdf'));
    if (pdfFlat) pdfPath = path.join(UPLOADS_DIR, pdfFlat);
  }

  if (!pdfPath) return 0;

  console.log(`[viewer] Convirtiendo PDF lazy: ${pdfPath}`);
  execSync(`pdftoppm -jpeg -r 120 "${pdfPath}" "${path.join(outDir, 'pagina')}"`, { timeout: 300000, stdio: 'pipe' });

  const imgs = fs.readdirSync(outDir)
    .filter(f => /^pagina.*\.(jpg|jpeg|ppm)$/i.test(f)).sort();

  const paginas = [];
  imgs.forEach((f, i) => {
    const nombre = `pagina_${i + 1}.jpg`;
    fs.renameSync(path.join(outDir, f), path.join(outDir, nombre));
    paginas.push(nombre);
  });

  // Insertar en DB
  for (let i = 0; i < paginas.length; i++) {
    db.run(
      'INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?,?,?,?)',
      [crypto.randomUUID(), patronId, i + 1, `patrones/${patronId}/${paginas[i]}`]
    );
  }
  db.run('UPDATE patrones SET paginas = ? WHERE id = ?', [paginas.length, patronId]);

  console.log(`[viewer] ✅ ${patronId}: ${paginas.length} páginas generadas`);
  return paginas.length;
}

// Entregar página de patrón (blob, no URL directa)
exports.getPagina = async (req, res) => {
  try {
    const { patronId, paginaNum } = req.params;
    const userId = req.userId;
    console.log(`[viewer] getPagina patronId=${patronId} num=${paginaNum} userId=${userId}`);

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

    // ── Lógica de acceso ────────────────────────────────────────────────────
    if (!userId) {
      return res.status(401).json({ error: 'sin_registro' });
    }

    const userTier = req.userTier || 'free';
    let tieneAcceso = false;

    if (userTier === 'premium') {
      tieneAcceso = true;
    } else {
      // Free: 3 pruebas únicas, luego 1 patrón nuevo por mes
      const yaAccedido = await new Promise(r =>
        db.get('SELECT 1 FROM progreso WHERE user_id = ? AND patron_id = ?', [userId, patronId], (_, row) => r(row))
      );
      if (yaAccedido) {
        tieneAcceso = true;
      } else {
        const cuenta = await new Promise(r =>
          db.get('SELECT COUNT(DISTINCT patron_id) as n FROM progreso WHERE user_id = ?', [userId], (_, row) => r(row?.n || 0))
        );
        if (cuenta < 3) {
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
            registrarVisita(patronId, userId, userTier, req);
            return res.status(403).json({ error: 'limite_free', patronesUsados: cuenta, patronesMes });
          }
        }
      }
    }

    if (!tieneAcceso) {
      return res.status(403).json({ error: 'sin_acceso' });
    }

    // Registrar visita (no bloquea)
    registrarVisita(patronId, userId, userTier, req);

    // Buscar archivo de página
    let pagina = await new Promise((resolve, reject) => {
      db.get(
        'SELECT archivo_path FROM paginas WHERE patron_id = ? AND numero = ?',
        [patronId, paginaNum],
        (err, row) => {
          if (err) reject(err); else resolve(row);
        }
      );
    });

    if (!pagina) {
      // Conversión lazy: convertir el PDF ahora y reintentar
      console.log(`[viewer] Sin páginas para ${patronId} — iniciando conversión lazy`);
      const generadas = convertirPDFLazy(patronId);
      if (generadas === 0) {
        return res.status(404).json({ error: 'Patrón sin archivo PDF disponible' });
      }
      // Reintentar buscar la página recién generada
      const paginaNueva = await new Promise((resolve, reject) => {
        db.get(
          'SELECT archivo_path FROM paginas WHERE patron_id = ? AND numero = ?',
          [patronId, paginaNum],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });
      if (!paginaNueva) {
        return res.status(404).json({ error: 'Página no disponible tras conversión' });
      }
      pagina = paginaNueva;
    }

    const filePath = path.join(__dirname, '../../uploads', pagina.archivo_path);
    console.log(`[viewer] Sirviendo archivo: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      console.error(`[viewer] Archivo no existe en disco: ${filePath}`);
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Actualizar progreso (primer_acceso solo se guarda en el INSERT, no en el UPDATE)
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO progreso (user_id, patron_id, pagina_actual, primer_acceso, ultimo_acceso)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
        `INSERT INTO progreso (user_id, patron_id, pagina_actual, primer_acceso, ultimo_acceso)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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