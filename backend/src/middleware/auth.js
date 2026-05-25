const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-en-prod';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`[401] Token ausente: ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userTier = decoded.tier;
    next();
  } catch (err) {
    console.warn(`[401] Token inválido (${err.message}): ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = authMiddleware;