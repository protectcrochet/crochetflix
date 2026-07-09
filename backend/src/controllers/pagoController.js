const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const https = require('https');
const http = require('http');
const db = require('../models');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================
// Precios locales por moneda (desde Stripe)
// ============================================
const PRECIOS_LOCALES = {
  USD: { unit_amount: 599,     monto: 5.99,     simbolo: '$',   moneda: 'USD', formato: '5.99' },
  MXN: { unit_amount: 10000,   monto: 100,      simbolo: '$',   moneda: 'MXN', formato: '100' },
  ARS: { unit_amount: 813039,  monto: 8130.39,  simbolo: '$',   moneda: 'ARS', formato: '8,130' },
  BRL: { unit_amount: 2921,    monto: 29.21,    simbolo: 'R$',  moneda: 'BRL', formato: '29.21' },
  CAD: { unit_amount: 797,     monto: 7.97,     simbolo: 'CA$', moneda: 'CAD', formato: '7.97' },
  CLP: { unit_amount: 5149,    monto: 5149,     simbolo: '$',   moneda: 'CLP', formato: '5,149', ceroDecimal: true },
  COP: { unit_amount: 2090830, monto: 20908.30, simbolo: '$',   moneda: 'COP', formato: '20,908' },
  EUR: { unit_amount: 495,     monto: 4.95,     simbolo: '€',   moneda: 'EUR', formato: '4.95' },
  GBP: { unit_amount: 429,     monto: 4.29,     simbolo: '£',   moneda: 'GBP', formato: '4.29' },
  GTQ: { unit_amount: 4390,    monto: 43.90,    simbolo: 'Q',   moneda: 'GTQ', formato: '43.90' },
  PEN: { unit_amount: 1965,    monto: 19.65,    simbolo: 'S/',  moneda: 'PEN', formato: '19.65' },
  DOP: { unit_amount: 34054,   monto: 340.54,   simbolo: 'RD$', moneda: 'DOP', formato: '340.54' },
  CRC: { unit_amount: 261019,  monto: 2610.19,  simbolo: '₡',  moneda: 'CRC', formato: '2,610' },
};

const PAIS_A_MONEDA = {
  US: 'USD', CA: 'CAD',
  MX: 'MXN',
  AR: 'ARS', BR: 'BRL', CO: 'COP', CL: 'CLP',
  PE: 'PEN', CR: 'CRC', GT: 'GTQ', DO: 'DOP',
  ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', FI: 'EUR',
  GB: 'GBP',
};

function getCountryFromIP(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return resolve('US');
    }
    const req = http.get(`http://ip-api.com/json/${ip}?fields=countryCode`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          resolve((obj.countryCode || 'US').toUpperCase());
        } catch { resolve('US'); }
      });
    });
    req.on('error', () => resolve('US'));
    req.on('timeout', () => { req.destroy(); resolve('US'); });
  });
}

// ============================================
// Rate Limiters
// ============================================
const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many webhook requests',
  standardHeaders: true,
  legacyHeaders: false
});

const crearPagoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiadas solicitudes de pago. Intenta más tarde.',
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// Precio local por IP
// ============================================
exports.precioLocal = async (req, res) => {
  try {
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const pais = await getCountryFromIP(ip);
    const moneda = PAIS_A_MONEDA[pais] || 'USD';
    const precio = PRECIOS_LOCALES[moneda] || PRECIOS_LOCALES.USD;
    res.json({ ...precio, pais });
  } catch (err) {
    res.json({ ...PRECIOS_LOCALES.USD, pais: 'US' });
  }
};

// ============================================
// Crear sesión de pago con Stripe
// ============================================
exports.crearPago = [crearPagoRateLimit, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.userId;
    const { plan = 'mensual', moneda: monedaReq = 'USD' } = req.body;

    if (!['mensual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido.' });
    }

    const precioData = PRECIOS_LOCALES[monedaReq] || PRECIOS_LOCALES.USD;

    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tier, subscription_expires_at, new_account_discount FROM users WHERE id = ?',
        [userId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) > new Date()) {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa' });
    }

    const unit_amount = precioData.unit_amount;
    const montoRegistro = unit_amount / (precioData.ceroDecimal ? 1 : 100);
    const label = 'CrochetFlix Premium — Mensual';

    const orderId = `CF-${uuidv4()}`;
    const pagoId = uuidv4();

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, order_id, monto_usd, status, plan, descuento_aplicado, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
        [pagoId, userId, orderId, montoRegistro, plan, 0],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: precioData.moneda.toLowerCase(),
          product_data: { name: label },
          unit_amount
        },
        quantity: 1
      }],
      metadata: { userId, orderId, plan },
      customer_email: req.userEmail || undefined,
      success_url: `${FRONTEND_URL}/perfil?pago=exitoso&order=${orderId}`,
      cancel_url: `${FRONTEND_URL}/perfil?pago=cancelado`
    });

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE pagos SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [session.id, pagoId],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    res.json({
      payment_url: session.url,
      checkout_url: session.url,
      session_id: session.id,
      order_id: orderId,
      amount: montoRegistro,
      descuento_aplicado: tieneDescuento,
      currency: precioData.moneda,
      plan
    });

  } catch (err) {
    console.error('Error crearPago:', err);
    res.status(500).json({ error: err.message || 'Error creando sesión de pago' });
  }
}];

// ============================================
// Webhook de Stripe
// ============================================
exports.webhook = [webhookRateLimit, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      return res.status(400).send('Missing body or signature');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Firma Stripe inválida:', err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const { orderId, plan } = session.metadata || {};
        const paymentIntentId = session.payment_intent;
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE pagos SET status = 'paid', stripe_payment_intent_id = ?, updated_at = datetime('now') WHERE order_id = ?`,
            [paymentIntentId, orderId],
            function(err) { if (err) reject(err); resolve(); }
          );
        });
        await activarPremium(orderId, plan);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error webhook Stripe:', err);
    res.status(500).send('Error interno');
  }
}];

// ============================================
// Activar suscripción premium
// ============================================
async function activarPremium(orderId, plan) {
  try {
    const pago = await new Promise((resolve, reject) => {
      db.get(
        `SELECT p.user_id, p.plan, u.tier, u.subscription_expires_at
         FROM pagos p JOIN users u ON p.user_id = u.id
         WHERE p.order_id = ?`,
        [orderId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (!pago) { console.error('Pago no encontrado para order:', orderId); return; }

    const dias = (pago.plan === 'anual') ? 365 : 30;
    let fechaExpiracion = new Date();
    if (pago.tier === 'premium' && pago.subscription_expires_at) {
      const existente = new Date(pago.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), pago.user_id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    console.log(`Premium activado: usuario ${pago.user_id}, expira ${fechaExpiracion.toISOString()}`);
  } catch (err) {
    console.error('Error activando premium:', err);
    throw err;
  }
}

// ============================================
// Verificar estado de pago
// ============================================
exports.verificarEstado = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.userId;

    if (!orderId || !orderId.startsWith('CF-')) {
      return res.status(400).json({ error: 'Order ID inválido' });
    }

    const pago = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM pagos WHERE order_id = ? AND user_id = ?',
        [orderId, userId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

    res.json({
      order_id: pago.order_id,
      status: pago.status,
      amount: pago.monto_usd,
      plan: pago.plan,
      descuento_aplicado: pago.descuento_aplicado === 1,
      created_at: pago.created_at,
      updated_at: pago.updated_at
    });
  } catch (err) {
    console.error('Error verificarEstado:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

module.exports.webhookRateLimit = webhookRateLimit;
module.exports.crearPagoRateLimit = crearPagoRateLimit;
