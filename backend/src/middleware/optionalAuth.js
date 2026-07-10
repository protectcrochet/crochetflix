const jwt = require('jsonwebtoken');

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.userId = null;
    req.userTier = 'free';
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userTier = decoded.tier;
  } catch {
    req.userId = null;
    req.userTier = 'free';
  }

  next();
}

module.exports = optionalAuth;
