const jwt = require('jsonwebtoken');
const db = require('../models');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userTier = decoded.tier;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireEmailVerified(req, res, next) {
  db.get('SELECT email_verified, tier, subscription_expires_at FROM users WHERE id = ?', [req.userId], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Usuario no encontrado' });
    // Premium activo (incluye la prueba de 3 días) puede acceder aunque aún no verifique el correo.
    // Así quien pagó justo al registrarse no queda bloqueado; el correo se valida en paralelo.
    const premiumActivo = row.tier === 'premium' && row.subscription_expires_at && new Date(row.subscription_expires_at) > new Date();
    if (!row.email_verified && !premiumActivo) {
      return res.status(403).json({ error: 'email_no_verificado', mensaje: 'Verifica tu correo electrónico para acceder a los patrones.' });
    }
    next();
  });
}

// Compatible con import por defecto y nombrado
module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.requireEmailVerified = requireEmailVerified;