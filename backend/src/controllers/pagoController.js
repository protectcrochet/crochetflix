const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../models');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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
// Crear sesión de pago con Stripe
// ============================================
exports.crearPago = [crearPagoRateLimit, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.userId;
    const { plan = 'mensual' } = req.body;

    if (!['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido. Use mensual o anual.' });
    }

    // Verificar usuario
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

    // Precios base en centavos USD
    const precios = {
      mensual: { centavos: 499,  label: 'CrochetFlix Premium — Mensual',  dias: 30 },
      anual:   { centavos: 4999, label: 'CrochetFlix Premium — Anual',    dias: 365 }
    };

    const planSeleccionado = precios[plan];
    const tieneDescuento = user?.new_account_discount === 1;
    // 25% de descuento para cuentas nuevas
    const centavosFinal = tieneDescuento
      ? Math.round(planSeleccionado.centavos * 0.75)
      : planSeleccionado.centavos;

    const orderId = `CF-${uuidv4()}`;
    const pagoId = uuidv4();

    // Guardar pago pendiente en DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, order_id, monto_usd, status, plan, descuento_aplicado, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
        [pagoId, userId, orderId, centavosFinal / 100, plan, tieneDescuento ? 1 : 0],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    const productName = tieneDescuento
      ? `${planSeleccionado.label} (25% descuento cuenta nueva)`
      : planSeleccionado.label;

    // Crear Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: productName },
          unit_amount: centavosFinal
        },
        quantity: 1
      }],
      metadata: {
        userId,
        orderId,
        plan,
        descuento: tieneDescuento ? '1' : '0'
      },
      customer_email: req.userEmail || undefined,
      success_url: `${FRONTEND_URL}/perfil?pago=exitoso&order=${orderId}`,
      cancel_url: `${FRONTEND_URL}/perfil?pago=cancelado`
    });

    // Guardar stripe_session_id
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE pagos SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [session.id, pagoId],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    res.json({
      payment_url: session.url,
      session_id: session.id,
      order_id: orderId,
      amount: centavosFinal / 100,
      original_amount: planSeleccionado.centavos / 100,
      descuento_aplicado: tieneDescuento,
      currency: 'USD',
      plan
    });

  } catch (err) {
    console.error('❌ Error crearPago:', err);
    res.status(500).json({ error: err.message || 'Error creando sesión de pago' });
  }
}];

// ============================================
// Webhook de Stripe
// CRÍTICO: verificar firma antes de procesar
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
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Firma Stripe inválida:', err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    // Procesar eventos relevantes
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      if (session.payment_status === 'paid') {
        const { orderId, plan } = session.metadata || {};
        const paymentIntentId = session.payment_intent;

        // Actualizar pago en DB
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE pagos SET status = 'paid', stripe_payment_intent_id = ?, updated_at = datetime('now')
             WHERE order_id = ?`,
            [paymentIntentId, orderId],
            function(err) { if (err) reject(err); resolve(); }
          );
        });

        await activarPremium(orderId, plan);
      }
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error('❌ Error procesando webhook Stripe:', err);
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

    if (!pago) {
      console.error('❌ Pago no encontrado para order:', orderId);
      return;
    }

    const dias = (pago.plan === 'anual') ? 365 : 30;

    let fechaExpiracion = new Date();
    if (pago.tier === 'premium' && pago.subscription_expires_at) {
      const existente = new Date(pago.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    // Activar premium y consumir el descuento de cuenta nueva (uso único)
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), pago.user_id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    console.log(`✅ Premium activado: usuario ${pago.user_id}, expira ${fechaExpiracion.toISOString()}`);

  } catch (err) {
    console.error('❌ Error activando premium:', err);
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
    console.error('❌ Error verificarEstado:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

module.exports.webhookRateLimit = webhookRateLimit;
module.exports.crearPagoRateLimit = crearPagoRateLimit;
