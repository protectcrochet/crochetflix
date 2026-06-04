const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-en-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Verificar si existe
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email ya registrado' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Crear usuario
    const userId = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (id, email, password_hash, tier) VALUES (?, ?, ?, ?)',
        [userId, email, passwordHash, 'free'],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Generar código de referido
    const refCode = crypto.randomBytes(4).toString('hex');
    await new Promise(r => db.run('UPDATE users SET referral_code = ? WHERE id = ?', [refCode, userId], () => r()));

    // Procesar referido si viene con código
    if (req.body.ref) {
      const referrer = await new Promise(r => db.get('SELECT id FROM users WHERE referral_code = ?', [req.body.ref], (_, row) => r(row)));
      if (referrer) {
        await new Promise(r => db.run('INSERT INTO referidos (id, referrer_id, referido_id) VALUES (?,?,?)', [uuidv4(), referrer.id, userId], () => r()));
        await new Promise(r => db.run('UPDATE users SET referred_by = ? WHERE id = ?', [referrer.id, userId], () => r()));
      }
    }

    // Generar JWT
    const token = jwt.sign(
      { userId, email, tier: 'free' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({
      message: 'Usuario creado',
      token,
      user: { id: userId, email, tier: 'free' }
    });

  } catch (err) {
    console.error('Error registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    // Buscar usuario
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Registrar sesión
    db.run(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?`, [user.id]);

    // Generar JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, tier: user.tier },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        subscription_expires_at: user.subscription_expires_at
      }
    });

  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.stats = async (req, res) => {
  try {
    const userId = req.userId;

    const [vistos, completados, enLista] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as total FROM progreso WHERE user_id = ?', [userId], (err, row) => {
          if (err) reject(err); else resolve(row.total);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as total FROM progreso WHERE user_id = ? AND completado = 1', [userId], (err, row) => {
          if (err) reject(err); else resolve(row.total);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as total FROM mi_lista WHERE user_id = ?', [userId], (err, row) => {
          if (err) reject(err); else resolve(row.total);
        });
      }),
    ]);

    res.json({ vistos, completados, enLista });
  } catch (err) {
    console.error('Error stats:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.historial = async (req, res) => {
  try {
    const userId = req.userId;
    const patrones = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.id, p.titulo, p.autor, p.diseñadora, p.thumbnail_path, p.paginas, p.categoria,
                pr.pagina_actual, pr.completado, pr.ultimo_acceso
         FROM progreso pr
         JOIN patrones p ON p.id = pr.patron_id
         WHERE pr.user_id = ? AND p.activo = 1
         ORDER BY pr.ultimo_acceso DESC
         LIMIT 10`,
        [userId],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    res.json({ patrones });
  } catch (err) {
    console.error('Error historial:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, email, tier, subscription_expires_at FROM users WHERE id = ?',
        [req.userId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user });

  } catch (err) {
    console.error('Error me:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.referidos = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT referral_code FROM users WHERE id = ?', [userId], (err, row) => { if (err) reject(err); else resolve(row); });
    });
    // Generate code if missing
    if (!user.referral_code) {
      const code = crypto.randomBytes(4).toString('hex');
      await new Promise(r => db.run('UPDATE users SET referral_code = ? WHERE id = ?', [code, userId], () => r()));
      user.referral_code = code;
    }
    const stats = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as total, SUM(convertido) as convertidos FROM referidos WHERE referrer_id = ?',
        [userId], (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });
    res.json({
      codigo: user.referral_code,
      total: stats?.total || 0,
      convertidos: stats?.convertidos || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
};