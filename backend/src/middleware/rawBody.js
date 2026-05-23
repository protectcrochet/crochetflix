// ============================================
// Middleware para capturar raw body
// Necesario para verificar firma HMAC de NOWPayments
// Debe ir ANTES de express.json()
// ============================================

function rawBody(req, res, next) {
  req.rawBody = '';

  // Solo para rutas de webhook
  if (!req.path.includes('/webhook')) {
    return next();
  }

  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', (err) => {
    console.error('❌ rawBody error:', err);
    next(err);
  });
}

module.exports = rawBody;
