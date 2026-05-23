const jwt = require('jsonwebtoken');

function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = decoded.userId;
      req.userTier = decoded.tier;
    } catch (_) {
      // token inválido → continúa sin auth
    }
  }
  next();
}

module.exports = authOptional;
