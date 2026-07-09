const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-en-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

exports.register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
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

    // Crear usuario — new_account_discount=1 para 25% OFF primera suscripción
    const userId = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (id, email, password_hash, tier, new_account_discount) VALUES (?, ?, ?, ?, ?)',
        [userId, email, passwordHash, 'free', 1],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Generar JWT
    const token = jwt.sign(
      { userId, email, tier: 'free' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({
      message: 'Usuario creado',
      token,
      user: { id: userId, email, tier: 'free', new_account_discount: 1 }
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
        subscription_expires_at: user.subscription_expires_at,
        new_account_discount: user.new_account_discount || 0
      }
    });

  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.historial = async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(`
        SELECT pr.patron_id as id, pat.titulo, pat.thumbnail_path, pat.paginas,
               pat.diseñadora, pat.autor, pat.categoria,
               pr.pagina_actual, pr.completado, pr.ultimo_acceso
        FROM progreso pr
        JOIN patrones pat ON pat.id = pr.patron_id
        WHERE pr.user_id = ? AND pat.activo = 1
        ORDER BY pr.ultimo_acceso DESC
        LIMIT 12
      `, [req.userId], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    res.json({ patrones });
  } catch (err) {
    console.error('Error historial:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.referidos = async (req, res) => {
  // Placeholder — se puede implementar sistema de referidos en el futuro
  res.json({ codigo: null, referidos: 0, descuento: 0 });
};

exports.me = async (req, res) => {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, email, tier, subscription_expires_at, new_account_discount FROM users WHERE id = ?',
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
